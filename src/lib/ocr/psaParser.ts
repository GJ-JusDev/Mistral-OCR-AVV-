/**
 * AVV System — PSA Certificate of Live Birth Parser
 *
 * Exclusively used as a SUPPORTING IDENTITY EVIDENCE document under RA 10173.
 * Extracts:
 * - Registry Number (Local Civil Registry Number / Certificate Number)
 * - Child's Name (First Name, Middle Name, Last Name, Complete Name)
 * - Sex ('M' | 'F')
 * - Date of Birth (YYYY-MM-DD)
 * - Place of Birth (Hospital, Municipality/City, Province)
 * - Mother's Maiden Name / Complete Name
 * - Father's Name / Complete Name
 * - Parents' Marriage Details
 *
 * CRITICAL PRIVACY & GOVERNANCE SAFEGUARDS:
 * - Never used to calculate grades, attendance, or promotion.
 * - Never automatically overwrites verified student profiles.
 * - Discrepancies are flagged for authorized teacher/registrar verification.
 * - Missing values are never invented.
 */

import { splitLearnerName } from "./shsSf1Parser";
import {
  classifyFieldRecognition,
  buildDocumentRecognitionSummary,
  type FieldRecognitionClassification,
  type DocumentRecognitionSummary,
} from "./handwritingExtractor";

export type FieldStatus = "extracted" | "needs_verification" | "not_detected";

export interface PsaFieldStatusItem {
  status: FieldStatus;
  value?: string;
  confidence?: number;
  notes?: string;
}

export interface PsaFieldStatusMap {
  complete_name: PsaFieldStatusItem;
  first_name: PsaFieldStatusItem;
  middle_name: PsaFieldStatusItem;
  last_name: PsaFieldStatusItem;
  birth_date: PsaFieldStatusItem;
  sex: PsaFieldStatusItem;
  birth_place: PsaFieldStatusItem;
  mother_name: PsaFieldStatusItem;
  mother_maiden_name?: PsaFieldStatusItem;
  father_name: PsaFieldStatusItem;
  registry_number: PsaFieldStatusItem;
}

export interface PsaIdentityFields {
  registry_number?: string;
  certificate_number?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  complete_name?: string;
  formatted_name?: string;
  suffix?: string;
  sex?: "M" | "F";
  birth_date?: string;
  birth_place?: {
    hospital?: string;
    city_municipality?: string;
    province?: string;
    raw?: string;
  };
  mother_maiden_name?: string;
  mother_name?: string;
  father_name?: string;
  parents_marriage_details?: {
    date?: string;
    place?: string;
  };
}

export interface PsaParseResult {
  identity: PsaIdentityFields;
  confidence: number;
  field_statuses: PsaFieldStatusMap;
  field_recognition?: Record<string, FieldRecognitionClassification>;
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
}

export interface PsaParseOptions {
  /** OCR text extracted from targeted upper identity section crop (Items 1 - 17: Child, Mother, Father) */
  upperSectionText?: string;
  /** OCR text extracted from targeted Child section crop (Items 1 - 5) */
  childSectionText?: string;
  /** OCR text extracted from targeted Item 1 Child Name crop */
  childNameText?: string;
}

export function toTitleCase(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Cleans OCR artifacts and parenthetical field instructions (e.g., "(First, Middle, Last)")
 * from extracted candidate name strings before validation and parsing.
 */
export function cleanPersonNameString(raw: string): string {
  if (!raw) return "";
  // Immediately reject/strip standalone parenthesized structural labels like (First), (Middla), (LAM), (Flrst)
  if (/^\s*\([A-Za-z0-9\.\s]{1,15}\)\s*$/.test(raw)) return "";

  return raw
    .replace(/^[:\s\-\.]+|[:\s\-\.]+$/g, "")
    .replace(
      /\([^)]*(?:first|flrst|firat|fist|middle|middla|middie|middl|mid|mlddle|last|lan|lam|lest|las|lat|laat|pangalan|apelyido|name)[^)]*\)/gi,
      " "
    )
    .replace(
      /\b(?:first|flrst|firat|fist|middle|middla|middie|middl|mid|mlddle|last|lan|lam|lest|las|lat|laat)\s*,?\s*(?:middle|last)?\s*,?\s*(?:last)?\b/gi,
      " "
    )
    .replace(/[|*_`()]+/g, " ")
    .replace(/^(?:\(?)(?:last|lan|las|lam|lat|lest|laat|apelyido|surname)(?:\)?)\s+/i, "")
    .replace(/^[:\s\-\.]+|[:\s\-\.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects official PSA Form header/label noise (e.g. "Chy/Municipality", "City/Municipality", "Province",
 * "Certificate of Live Birth", "Registry No") to prevent it from leaking into person names.
 */
export function isPsaHeaderNoise(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  const lower = str.replace(/[|*_`()]+/g, "").trim().toLowerCase();
  if (lower.length === 0) return true;
  return (
    lower.includes("republic") ||
    lower.includes("civil registrar") ||
    lower.includes("certificate of live birth") ||
    lower.includes("birth certificate") ||
    lower.includes("registry no") ||
    lower.includes("form no") ||
    /^(?:province|lalawigan)[:\s]*/i.test(lower) ||
    /^(?:city\/municipality|chy\/municipality|lungsod\/bayan|municipality|city)[:\s]*/i.test(lower) ||
    lower === "province" ||
    lower === "city/municipality" ||
    lower === "chy/municipality" ||
    lower === "national statistics" ||
    lower === "philippine statistics"
  );
}

/**
 * Strict validator to prevent non-person tokens, administrative boundaries,
 * and geographic locations from being mapped as personal names (Child, Mother, Father).
 */
export function isInvalidPersonName(str: string): boolean {
  if (!str || typeof str !== "string") return true;
  const trimmed = str.replace(/[|*_`()]+/g, "").trim();
  if (trimmed.length < 2) return true;

  // Digits are forbidden in Philippine birth certificate names
  if (/\d/.test(trimmed)) return true;

  // General safeguard: Reject any standalone parenthesized token like (First), (Middla), (LAM), (Fist), etc.
  if (/^\s*\([A-Za-z0-9\.\s]{1,15}\)\s*$/.test(trimmed) || /^\([A-Za-z0-9\.\s]{1,15}\)$/.test(str.trim())) {
    return true;
  }

  const lower = trimmed.toLowerCase();

  // 1. Geographic, administrative, and address tokens (prevents "RIN CAL. CITY", "QUEZON CITY", etc.)
  const geoTerms = [
    "cal. city",
    "cal city",
    "city/municipality",
    "chy/municipality",
    "city",
    "municipality",
    "province",
    "lalawigan",
    "bayan",
    "lungsod",
    "barangay",
    "brgy",
    "bgy",
    "street",
    "st.",
    "avenue",
    "ave.",
    "road",
    "rd.",
    "boulevard",
    "blvd",
    "district",
    "subdivision",
    "subd",
    "poblacion",
    "hospital",
    "clinic",
    "health center",
    "philippines",
    "pilipinas",
    "metro manila",
    "caloocan",
    "pasig",
    "makati",
    "manila",
    "quezon",
    "taguig",
  ];
  for (const term of geoTerms) {
    const regex = new RegExp(`(^|\\b|\\s)${term.replace(".", "\\.")}(\\b|\\s|$)`, "i");
    if (regex.test(lower)) return true;
  }

  // 2. Official PSA Form labels and document metadata
  const docLabels = [
    "republic",
    "office of the civil registrar",
    "civil registrar",
    "certificate of live birth",
    "certificate",
    "registry",
    "rehistro",
    "national statistics",
    "philippine statistics",
    "birth certificate",
    "form no",
    "page",
    "sheet",
    "remarks",
    "annotation",
    "citizenship",
    "religion",
    "occupation",
    "kasarian",
    "sex",
    "petsa",
    "lugar",
    "kapanganakan",
    "date of birth",
    "place of birth",
    "informant",
    "attendant",
    "marriage",
    "kasal",
  ];
  for (const label of docLabels) {
    if (lower.includes(label)) return true;
  }

  // 3. Uninformative placeholder tokens
  const placeholders = [
    "unknown",
    "not detected",
    "none",
    "wala",
    "n/a",
    "na",
    "null",
    "undefined",
    "blurred",
    "unreadable",
    "random",
    "field",
    "valid",
    "without",
    "line",
  ];
  if (placeholders.includes(lower)) return true;

  // 4. Must contain at least two alphabetical characters
  const alphaCount = (trimmed.match(/[a-zA-ZñÑ]/g) || []).length;
  if (alphaCount < 2) return true;

  return false;
}

export interface PsaDocumentSections {
  childSectionText: string;
  motherSectionText: string;
  fatherSectionText: string;
  fullText: string;
}

/**
 * Segments PSA text into strict section boundaries to prevent cross-section bleeding.
 */
export function extractPsaSections(rawText: string): PsaDocumentSections {
  const text = rawText || "";

  // Mother section starts around "6. MAIDEN NAME" or "MOTHER" or "INA"
  const motherMatch = text.match(
    /(?:\b(?:6\.\s*)?maiden\s*name\b|\bmother(?:\'?s?\s*(?:maiden\s*)?name)?\b|\bpangalan\s*ng\s*ina\b|\bina\b)/i
  );
  const motherIdx = motherMatch ? motherMatch.index! : -1;

  // Father section starts around "13. NAME" or "FATHER" or "AMA"
  const fatherMatch = text.match(
    /(?:\b13\.\s*name\b|\bfather(?:\'?s?\s*name)?\b|\bpangalan\s*ng\s*ama\b|\bama\b)/i
  );
  const fatherIdx = fatherMatch ? fatherMatch.index! : -1;

  // Marriage section starts around "20. MARRIAGE" or "MARRIAGE OF PARENTS"
  const marriageMatch = text.match(/(?:\b20\.\s*marriage\b|\bmarriage\s*of\s*parents\b|\bkasal\s*ng\s*mga\s*magulang\b)/i);
  const marriageIdx = marriageMatch ? marriageMatch.index! : -1;

  let childSectionText = text;
  let motherSectionText = "";
  let fatherSectionText = "";

  if (motherIdx !== -1) {
    childSectionText = text.slice(0, motherIdx);
    if (fatherIdx !== -1 && fatherIdx > motherIdx) {
      motherSectionText = text.slice(motherIdx, fatherIdx);
      fatherSectionText = marriageIdx !== -1 && marriageIdx > fatherIdx
        ? text.slice(fatherIdx, marriageIdx)
        : text.slice(fatherIdx);
    } else {
      motherSectionText = text.slice(motherIdx);
    }
  } else if (fatherIdx !== -1) {
    childSectionText = text.slice(0, fatherIdx);
    fatherSectionText = marriageIdx !== -1 && marriageIdx > fatherIdx
      ? text.slice(fatherIdx, marriageIdx)
      : text.slice(fatherIdx);
  }

  return {
    childSectionText,
    motherSectionText,
    fatherSectionText,
    fullText: text,
  };
}

interface ChildNameCandidate {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  completeName?: string;
  isAmbiguous?: boolean;
}

/**
 * Extracts Child's Name from text using multi-strategy inspection.
 */
function extractChildNameFromText(
  text: string,
  isTargetedNameCrop: boolean = false
): ChildNameCandidate | null {
  if (!text || text.trim().length === 0) return null;

  // 1. Determine anchor boundary between Item 1 (NAME) and Item 2 (SEX) to exclude document headers and trailing form fields
  let targetBlock = text;
  const nameAnchor = text.match(/(?:\b1\.\s*name(?:\s*of\s*child)?\b|\bname\s*of\s*child\b|\bchild\'?s?\s*name\b|\bpangalan\s*(?:ng\s*bata)?\b)/i);
  const sexAnchor = text.match(/(?:\(?\s*2\.\s*sex\b|\b2\.\s*kasarian\b|\bkasarian\b|\(?\s*3\.\s*date\b|\bdate\s*of\s*birth\b|\bpetsa\b|\(?\s*4\.\s*place\b|\bplace\s*of\s*birth\b)/i);

  if (nameAnchor && nameAnchor.index !== undefined) {
    const startIdx = nameAnchor.index + nameAnchor[0].length;
    const endIdx = sexAnchor && sexAnchor.index !== undefined && sexAnchor.index > startIdx
      ? sexAnchor.index
      : text.length;
    targetBlock = text.slice(startIdx, endIdx);
  } else if (sexAnchor && sexAnchor.index !== undefined && !isTargetedNameCrop) {
    targetBlock = text.slice(0, sexAnchor.index);
  }

  // Strategy 0: Comma format, e.g. "DELA CRUZ, CARLOS MIGUEL" (Surname first)
  const commaMatch = targetBlock.match(/[:\s\-]*([a-zA-ZñÑ\s\.\-]+),\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*2\.\s*sex\b|\bsex\b|$|\r|\n))/i);
  if (commaMatch) {
    const rawLn = cleanPersonNameString(commaMatch[1]);
    const rawRest = cleanPersonNameString(commaMatch[2]);
    if (!isInvalidPersonName(rawLn) && !isInvalidPersonName(rawRest) && !isPsaHeaderNoise(rawLn)) {
      const restTokens = rawRest.split(/\s+/).filter(Boolean);
      if (restTokens.length >= 2) {
        const fn = toTitleCase(restTokens.slice(0, -1).join(" "));
        const mn = toTitleCase(restTokens[restTokens.length - 1]);
        const ln = toTitleCase(rawLn);
        return {
          firstName: fn,
          middleName: mn,
          lastName: ln,
          completeName: `${fn} ${mn} ${ln}`,
        };
      } else if (restTokens.length === 1) {
        const fn = toTitleCase(restTokens[0]);
        const ln = toTitleCase(rawLn);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: ln,
          completeName: `${fn} ${ln}`,
        };
      }
    }
  }

  // Strategy 1: Explicit inline labeled tokens, e.g. "(First) JUSTIN (Middle) LOQUILLANO (Last) GOMEZ"
  // Handles OCR label typos like (Flrst), (Middla), (LAM), (Lest), (Las), (Lat), (Laat), (Lan)
  const explicitInline = targetBlock.match(
    /(?:(?:1a\.\s*)?\(?\s*(?:first|flrst|firat|fist)(?:\s*name)?\s*\)?|\bunang\s*pangalan\b)[:\s\-_]*([a-zA-ZñÑ\s\.\-]+?)(?=(?:(?:1b\.\s*)?\(?\s*(?:middle|middla|middie|middl|mid|mlddle)(?:\s*name)?\s*\)?|\bgitnang\s*pangalan\b))[:\s\-_]*(?:(?:1b\.\s*)?\(?\s*(?:middle|middla|middie|middl|mid|mlddle)(?:\s*name)?\s*\)?|\bgitnang\s*pangalan\b)[:\s\-_]*([a-zA-ZñÑ\s\.\-]+?)(?=(?:(?:1c\.\s*)?\(?\s*(?:last|lan|lam|lest|las|lat|laat)(?:\s*name)?\s*\)?|\bapelyido\b|\bsurname\b))[:\s\-_]*(?:(?:1c\.\s*)?\(?\s*(?:last|lan|lam|lest|las|lat|laat)(?:\s*name)?\s*\)?|\bapelyido\b|\bsurname\b)[:\s\-_]*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*2\.\s*sex\b|\b2\.\s*kasarian\b|\bkasarian\b|date\s*of\s*birth|3\.\s*date|petsa|4\.\s*place|place\s*of\s*birth|$|\r|\n))/i
  );
  if (explicitInline) {
    const fn = cleanPersonNameString(explicitInline[1]);
    const mn = cleanPersonNameString(explicitInline[2]);
    const ln = cleanPersonNameString(explicitInline[3]);
    if (!isInvalidPersonName(fn) && !isInvalidPersonName(ln) && !isPsaHeaderNoise(fn) && !isPsaHeaderNoise(ln)) {
      const middleName = mn && !/^(none|n\/?a|wala|-)$/i.test(mn) && !isInvalidPersonName(mn) ? toTitleCase(mn) : undefined;
      return {
        firstName: toTitleCase(fn),
        middleName,
        lastName: toTitleCase(ln),
        completeName: [toTitleCase(fn), middleName, toTitleCase(ln)].filter(Boolean).join(" "),
      };
    }
  }

  // Strategy 1b: Separate labeled tokens on single or multiple lines
  const fnMatch = targetBlock.match(
    /(?:(?:\(?\s*1a\.\s*)?(?:\(?\s*(?:first|flrst|firat|fist)(?:\s*name)?\s*\)?|unang\s*pangalan))\s*[:\-]?\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*(?:1b\.\s*)?(?:middle|middla|middie|middl|mid|mlddle)|\(?\s*(?:1c\.\s*)?(?:last|lan|lam|lest|las|lat|laat)|gitnang|apelyido|sex|kasarian|2\.\s*sex|$|\r|\n))/i
  );
  const mnMatch = targetBlock.match(
    /(?:(?:\(?\s*1b\.\s*)?(?:\(?\s*(?:middle|middla|middie|middl|mid|mlddle)(?:\s*name)?\s*\)?|gitnang\s*pangalan))\s*[:\-]?\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*(?:1c\.\s*)?(?:last|lan|lam|lest|las|lat|laat)|apelyido|sex|kasarian|date|petsa|2\.\s*sex|3\.\s*date|$|\r|\n))/i
  );
  const lnMatch = targetBlock.match(
    /(?:(?:\(?\s*1c\.\s*)?(?:\(?\s*(?:last|lan|lam|lest|las|lat|laat)(?:\s*name)?\s*\)?|apelyido|surname))\s*[:\-]?\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*(?:first|flrst|firat|fist)|\(?\s*(?:middle|middla|middie|middl|mid|mlddle)|sex|kasarian|date|petsa|place|lugar|2\.\s*sex|3\.\s*date|4\.\s*place|$|\r|\n))/i
  );

  if (fnMatch && lnMatch) {
    const fnClean = cleanPersonNameString(fnMatch[1]);
    const lnClean = cleanPersonNameString(lnMatch[1]);
    const mnClean = mnMatch ? cleanPersonNameString(mnMatch[1]) : "";

    if (!isInvalidPersonName(fnClean) && !isInvalidPersonName(lnClean) && !isPsaHeaderNoise(fnClean) && !isPsaHeaderNoise(lnClean)) {
      let middleName: string | undefined = undefined;
      if (mnClean && !/^(none|n\/?a|wala|-|middle|gitna)$/i.test(mnClean) && !isInvalidPersonName(mnClean)) {
        middleName = toTitleCase(mnClean);
      }
      return {
        firstName: toTitleCase(fnClean),
        middleName,
        lastName: toTitleCase(lnClean),
        completeName: [toTitleCase(fnClean), middleName, toTitleCase(lnClean)].filter(Boolean).join(" "),
      };
    }
  }

  // Strategy 1c: Multiline state machine scanner inside targetBlock
  // Tracks (First), (Middle), (Last|LAM|Lest|Las|Lat|Lan) and assigns trailing unlabelled lines right before 2. SEX
  const rawLines = targetBlock
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l || l.length < 2) return false;
      if (isPsaHeaderNoise(l)) return false;
      if (/^(?:1\.\s*)?name(?:\s*of\s*child)?$/i.test(l)) return false;
      if (/^(?:1a\.|1b\.|1c\.|2\.\s*sex|sex|kasarian|date\s*of\s*birth|3\.\s*date|4\.\s*place)$/i.test(l)) return false;
      return true;
    });

  let detectedFirst: string | undefined;
  let detectedMiddle: string | undefined;
  let detectedLast: string | undefined;
  let currentSlot: "first" | "middle" | "last" | "none" = "none";

  for (const line of rawLines) {
    const firstM = line.match(/^(?:(?:\(?\s*(?:1a\.\s*)?(?:first|flrst|firat|fist)(?:\s*name)?\s*\)?|unang\s*pangalan)[:\s\-_]*)(.*)$/i);
    if (firstM) {
      currentSlot = "first";
      const rem = cleanPersonNameString(firstM[1]);
      if (rem && !isInvalidPersonName(rem) && !isPsaHeaderNoise(rem)) detectedFirst = rem;
      continue;
    }

    const middleM = line.match(/^(?:(?:\(?\s*(?:1b\.\s*)?(?:middle|middla|middie|middl|mid|mlddle)(?:\s*name)?\s*\)?|gitnang\s*pangalan)[:\s\-_]*)(.*)$/i);
    if (middleM) {
      currentSlot = "middle";
      const rem = cleanPersonNameString(middleM[1]);
      if (rem && !/^(none|n\/?a|wala|-)$/i.test(rem) && !isInvalidPersonName(rem) && !isPsaHeaderNoise(rem)) {
        detectedMiddle = rem;
      }
      continue;
    }

    const lastM = line.match(/^(?:(?:\(?\s*(?:1c\.\s*)?(?:last|lan|lam|lest|las|lat|laat)(?:\s*name)?\s*\)?|apelyido|surname)[:\s\-_]*)(.*)$/i);
    if (lastM) {
      currentSlot = "last";
      const rem = cleanPersonNameString(lastM[1]);
      if (rem && !isInvalidPersonName(rem) && !isPsaHeaderNoise(rem)) detectedLast = rem;
      continue;
    }

    // General safeguard: ignore any standalone parenthesized token as an unrecognized structural label
    if (/^\s*\([A-Za-z0-9\.\s]{1,15}\)\s*$/.test(line)) {
      continue;
    }

    const clean = cleanPersonNameString(line);
    if (!clean || isInvalidPersonName(clean) || isPsaHeaderNoise(clean)) continue;

    if (currentSlot === "first" && !detectedFirst) {
      detectedFirst = clean;
    } else if (currentSlot === "first" && detectedFirst && !detectedMiddle) {
      detectedMiddle = clean;
    } else if (currentSlot === "middle" && !detectedMiddle) {
      if (!/^(none|n\/?a|wala|-)$/i.test(clean)) detectedMiddle = clean;
    } else if (currentSlot === "middle" && detectedMiddle && !detectedLast) {
      detectedLast = clean;
    } else if (currentSlot === "last" && !detectedLast) {
      detectedLast = clean;
    } else if (detectedFirst && detectedMiddle && !detectedLast) {
      // Missing (Last) label right before Item 2 (SEX)
      detectedLast = clean;
    } else if (detectedFirst && !detectedLast) {
      detectedLast = clean;
    }
  }

  if (detectedFirst && detectedLast && !isInvalidPersonName(detectedFirst) && !isInvalidPersonName(detectedLast)) {
    const fn = toTitleCase(cleanPersonNameString(detectedFirst));
    const mn = detectedMiddle && !/^(none|n\/?a|wala|-)$/i.test(detectedMiddle) ? toTitleCase(cleanPersonNameString(detectedMiddle)) : undefined;
    const cleanedLast = cleanPersonNameString(detectedLast).replace(/^(?:\(?)(?:last|lan|las|lam|lat|lest|laat|apelyido|surname)(?:\)?)\s+/i, "");
    const ln = toTitleCase(cleanedLast);
    return {
      firstName: fn,
      middleName: mn,
      lastName: ln,
      completeName: [fn, mn, ln].filter(Boolean).join(" "),
    };
  }

  // Strategy 2: Clean non-header lines in Item 1 crop or table row
  // PSA Form 102 Item 1 is laid out horizontally into three columns: (First) (Middle) (Last)
  const validCandidateLines = rawLines
    .map(cleanPersonNameString)
    .filter((l) => !isInvalidPersonName(l) && !isPsaHeaderNoise(l));

  const hasNameHeader = /(?:\b(?:1\.\s*)?name(?:\s*of\s*child)?\b|\bpangalan\s*(?:ng\s*bata)?\b|\bchild\'?s?\s*name\b)/i.test(text);
  if ((isTargetedNameCrop || hasNameHeader) && validCandidateLines.length >= 1) {
    if (validCandidateLines.length === 3) {
      // 3 separate lines: First, Middle, Last
      const fn = toTitleCase(validCandidateLines[0]);
      const mn = toTitleCase(validCandidateLines[1]);
      const cleanedLast = validCandidateLines[2].replace(/^(?:\(?)(?:last|lan|las|lam|lat|lest|laat|apelyido|surname)(?:\)?)\s+/i, "");
      const ln = toTitleCase(cleanedLast);
      return {
        firstName: fn,
        middleName: mn,
        lastName: ln,
        completeName: `${fn} ${mn} ${ln}`,
      };
    } else if (validCandidateLines.length === 2 && isTargetedNameCrop) {
      // 2 separate lines in targeted crop: First, Last
      const fn = toTitleCase(validCandidateLines[0]);
      const cleanedLast = validCandidateLines[1].replace(/^(?:\(?)(?:last|lan|las|lam|lat|lest|laat|apelyido|surname)(?:\)?)\s+/i, "");
      const ln = toTitleCase(cleanedLast);
      return {
        firstName: fn,
        middleName: undefined,
        lastName: ln,
        completeName: `${fn} ${ln}`,
      };
    } else {
      // 1 line containing horizontal columns: e.g. "JUSTIN LOQUILLANO GOMEZ"
      const nameLine = validCandidateLines[0];
      let tokens = nameLine.split(/\s+/).filter(Boolean);
      let detectedSuffix: string | undefined;
      const suffixRegex = /^(?:jr\.?|sr\.?|ii|iii|iv|v|vi)$/i;
      if (tokens.length >= 3 && suffixRegex.test(tokens[tokens.length - 1])) {
        detectedSuffix = tokens[tokens.length - 1].toUpperCase();
        tokens = tokens.slice(0, -1);
      }
      if (tokens.length >= 3) {
        // Form 102 horizontal 3-column standard: Token 0 = First, Token 1 = Middle, Token 2 = Last
        if (tokens.length === 3) {
          const compoundPrefixes = ["de", "del", "dela", "de la", "san", "santa", "de los", "delos"];
          if (compoundPrefixes.includes(tokens[1].toLowerCase())) {
            const fn = toTitleCase(tokens[0]);
            const ln = toTitleCase(`${tokens[1]} ${tokens[2]}`);
            return {
              firstName: fn,
              middleName: undefined,
              lastName: ln,
              suffix: detectedSuffix,
              completeName: [fn, ln, detectedSuffix].filter(Boolean).join(" "),
            };
          }
          const fn = toTitleCase(tokens[0]);
          const mn = toTitleCase(tokens[1]);
          const ln = toTitleCase(tokens[2]);
          return {
            firstName: fn,
            middleName: mn,
            lastName: ln,
            suffix: detectedSuffix,
            completeName: [fn, mn, ln, detectedSuffix].filter(Boolean).join(" "),
          };
        } else {
          // Check for compound surname (e.g. Dela Cruz)
          const compoundPrefixes = ["de", "del", "dela", "de la", "san", "santa", "de los", "delos"];
          const n = tokens.length;
          if (n >= 4 && compoundPrefixes.includes(tokens[n - 2].toLowerCase())) {
            const ln = toTitleCase(`${tokens[n - 2]} ${tokens[n - 1]}`);
            const mn = toTitleCase(tokens[n - 3]);
            const fn = toTitleCase(tokens.slice(0, n - 3).join(" "));
            return {
              firstName: fn,
              middleName: mn,
              lastName: ln,
              suffix: detectedSuffix,
              completeName: [fn, mn, ln, detectedSuffix].filter(Boolean).join(" "),
            };
          }
          // Standard 4-token name: First two are First Name, next is Middle, last is Last Name
          const fn = toTitleCase(tokens.slice(0, n - 2).join(" "));
          const mn = toTitleCase(tokens[n - 2]);
          const ln = toTitleCase(tokens[n - 1]);
          return {
            firstName: fn,
            middleName: mn,
            lastName: ln,
            suffix: detectedSuffix,
            completeName: [fn, mn, ln, detectedSuffix].filter(Boolean).join(" "),
          };
        }
      } else if (tokens.length === 2) {
        const fn = toTitleCase(tokens[0]);
        const ln = toTitleCase(tokens[1]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: ln,
          suffix: detectedSuffix,
          completeName: [fn, ln, detectedSuffix].filter(Boolean).join(" "),
        };
      } else if (tokens.length === 1) {
        const fn = toTitleCase(tokens[0]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: "Unknown",
          suffix: detectedSuffix,
          completeName: fn,
          isAmbiguous: true,
        };
      }
    }
  }

  // Strategy 3: Item 1 Header followed by single-line full name (e.g., 1. NAME: JUAN DELA CRUZ or NAME OF CHILD)
  const childMatch = text.match(
    /(?:(?:\b(?:1\.\s*)?name(?:\s*of\s*child)?\b|\bpangalan\s*(?:ng\s*bata)?\b|\bchild(?:\'?s?\s*name)?\b)[:\s\-]+(?:\([^\)]*\))?[:\s\-]*([a-zA-ZñÑ\s\.\,\-]+?)(?=(?:\(?\s*2\.\s*sex\b|\bsex\b|date\s*of\s*birth|kasarian|3\.\s*date|petsa|4\.\s*place|place\s*of\s*birth|$|\r|\n)))/i
  );

  if (childMatch) {
    const candidateName = cleanPersonNameString(childMatch[1]);
    if (!isInvalidPersonName(candidateName) && !isPsaHeaderNoise(candidateName)) {
      let tokens = candidateName.split(/\s+/).filter(Boolean);
      let detectedSuffix: string | undefined;
      const suffixRegex = /^(?:jr\.?|sr\.?|ii|iii|iv|v|vi)$/i;
      if (tokens.length >= 3 && suffixRegex.test(tokens[tokens.length - 1])) {
        detectedSuffix = tokens[tokens.length - 1].toUpperCase();
        tokens = tokens.slice(0, -1);
      }
      if (tokens.length >= 3) {
        const compoundPrefixes = ["de", "del", "dela", "de la", "san", "santa", "de los", "delos"];
        const n = tokens.length;
        if (n >= 4 && compoundPrefixes.includes(tokens[n - 2].toLowerCase())) {
          const ln = toTitleCase(`${tokens[n - 2]} ${tokens[n - 1]}`);
          const mn = toTitleCase(tokens[n - 3]);
          const fn = toTitleCase(tokens.slice(0, n - 3).join(" "));
          return {
            firstName: fn,
            middleName: mn,
            lastName: ln,
            suffix: detectedSuffix,
            completeName: [fn, mn, ln, detectedSuffix].filter(Boolean).join(" "),
          };
        }
        if (tokens.length === 3 && compoundPrefixes.includes(tokens[1].toLowerCase())) {
          const fn = toTitleCase(tokens[0]);
          const ln = toTitleCase(`${tokens[1]} ${tokens[2]}`);
          return {
            firstName: fn,
            middleName: undefined,
            lastName: ln,
            suffix: detectedSuffix,
            completeName: [fn, ln, detectedSuffix].filter(Boolean).join(" "),
          };
        }
        const fn = toTitleCase(tokens[0]);
        const mn = toTitleCase(tokens.slice(1, -1).join(" "));
        const ln = toTitleCase(tokens[tokens.length - 1]);
        return {
          firstName: fn,
          middleName: mn,
          lastName: ln,
          suffix: detectedSuffix,
          completeName: [fn, mn, ln, detectedSuffix].filter(Boolean).join(" "),
        };
      } else if (tokens.length === 2) {
        const fn = toTitleCase(tokens[0]);
        const ln = toTitleCase(tokens[1]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: ln,
          suffix: detectedSuffix,
          completeName: [fn, ln, detectedSuffix].filter(Boolean).join(" "),
        };
      } else if (tokens.length === 1) {
        const fn = toTitleCase(tokens[0]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: "Unknown",
          suffix: detectedSuffix,
          completeName: fn,
          isAmbiguous: true,
        };
      }
    }
  }

  return null;
}

/**
 * Extracts Mother or Father Name strictly anchored within their section boundaries
 * (Mother: Item 6 MAIDEN NAME to Item 7 CITIZENSHIP; Father: Item 13 NAME to Item 14 CITIZENSHIP).
 * Supports multiline values even if the (Last) label is missing or mistyped in OCR.
 */
function extractParentNameFromSection(
  sectionText: string,
  startPattern: RegExp,
  endPattern: RegExp
): string | undefined {
  if (!sectionText) return undefined;
  const startMatch = sectionText.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return undefined;

  const afterStart = sectionText.slice(startMatch.index + startMatch[0].length);
  const endMatch = afterStart.match(endPattern);
  const block = endMatch && endMatch.index !== undefined
    ? afterStart.slice(0, endMatch.index)
    : afterStart.slice(0, 400);

  // Scan lines in candidate block
  const lines = block
    .split(/\r?\n/)
    .map((l) => cleanPersonNameString(l))
    .filter((l) => {
      if (!l || l.length < 2) return false;
      if (isPsaHeaderNoise(l)) return false;
      return true;
    });

  let first: string | undefined;
  let middle: string | undefined;
  let last: string | undefined;
  let currentSlot: "first" | "middle" | "last" | "none" = "none";

  for (const line of lines) {
    const fnM = line.match(/^(?:(?:\(?\s*first(?:\s*name)?\s*\)?|unang\s*pangalan)[:\s\-_]*)(.*)$/i);
    if (fnM) {
      currentSlot = "first";
      const rem = cleanPersonNameString(fnM[1]);
      if (rem && !isInvalidPersonName(rem) && !isPsaHeaderNoise(rem)) first = rem;
      continue;
    }

    const mnM = line.match(/^(?:(?:\(?\s*middle(?:\s*name)?\s*\)?|gitnang\s*pangalan)[:\s\-_]*)(.*)$/i);
    if (mnM) {
      currentSlot = "middle";
      const rem = cleanPersonNameString(mnM[1]);
      if (rem && !/^(none|n\/?a|wala|-)$/i.test(rem) && !isInvalidPersonName(rem) && !isPsaHeaderNoise(rem)) {
        middle = rem;
      }
      continue;
    }

    const lnM = line.match(/^(?:(?:\(?\s*(?:last|lam|lest|las|lat)(?:\s*name)?\s*\)?|apelyido|surname)[:\s\-_]*)(.*)$/i);
    if (lnM) {
      currentSlot = "last";
      const rem = cleanPersonNameString(lnM[1]);
      if (rem && !isInvalidPersonName(rem) && !isPsaHeaderNoise(rem)) last = rem;
      continue;
    }

    const clean = cleanPersonNameString(line);
    if (isInvalidPersonName(clean) || isPsaHeaderNoise(clean)) continue;

    if (currentSlot === "first" && !first) {
      first = clean;
    } else if (currentSlot === "middle" && !middle) {
      if (!/^(none|n\/?a|wala|-)$/i.test(clean)) middle = clean;
    } else if (currentSlot === "last" && !last) {
      last = clean;
    } else if (first && middle && !last) {
      // Missing (Last) label right before citizenship or next item
      last = clean;
    }
  }

  if (first && last && !isInvalidPersonName(first) && !isInvalidPersonName(last)) {
    return [first, middle && !/^(none|n\/?a|wala|-)$/i.test(middle) ? middle : undefined, last].filter(Boolean).join(" ");
  }

  // Handle single-line or unlabelled lines
  const validCandidateLines = lines
    .map(cleanPersonNameString)
    .filter((l) => !isInvalidPersonName(l) && !isPsaHeaderNoise(l));

  if (validCandidateLines.length >= 3) {
    return [
      validCandidateLines[0],
      validCandidateLines[1],
      validCandidateLines[2],
    ].join(" ");
  } else if (validCandidateLines.length === 2) {
    return `${validCandidateLines[0]} ${validCandidateLines[1]}`;
  } else if (validCandidateLines.length === 1) {
    return validCandidateLines[0];
  }

  return undefined;
}

export function parsePsaBirthCert(
  rawText: string,
  rawLayout?: any,
  ocrConfidence: number = 0.95,
  options?: PsaParseOptions
): PsaParseResult {
  const warnings: string[] = [];
  const sections = extractPsaSections(rawText);

  // 1. Registry Number or PSA Certificate Number
  // Supports multi-part formats separated by dots, dashes, or spaces (e.g. "204. 52545" -> "204-52545")
  let registryNumber: string | undefined;
  const regSearchText = options?.upperSectionText || rawText;
  const regMatch = regSearchText.match(
    /(?:(?:psa\s*)?certificate\s*(?:no\.?|number)|registry\s*(?:no\.?|number)|rehistro\s*blg\.?|local\s*civil\s*registry\s*no\.?|lcr\s*no\.?)[:\s]*([0-9][0-9\.\- \t]*[0-9]|[0-9]+)/i
  );
  if (regMatch) {
    const rawReg = regMatch[1].trim();
    registryNumber = rawReg
      .replace(/[\.\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // 2. Child Name (First, Middle, Last, Suffix, Complete Name)
  let firstName = "Unknown";
  let middleName: string | undefined;
  let lastName = "Unknown";
  let suffix: string | undefined;
  let completeName: string | undefined;
  let isNameAmbiguous = false;

  // Attempt child name extraction across sources with completeness scoring.
  // CRITICAL: A narrow partial crop (e.g. only First Name) must NEVER overwrite
  // a more complete candidate (First + Middle + Last) extracted from upperSectionText or full document.
  function getCandidateCompletenessScore(cand: ChildNameCandidate | null): number {
    if (!cand) return 0;
    const hasFirst = cand.firstName && cand.firstName !== "Unknown" && cand.firstName.trim().length > 0;
    const hasMiddle = cand.middleName && cand.middleName.trim().length > 0 && !/^(none|n\/?a|wala|-)$/i.test(cand.middleName);
    const hasLast = cand.lastName && cand.lastName !== "Unknown" && cand.lastName.trim().length > 0;

    if (hasFirst && hasMiddle && hasLast) return 4;
    if (hasFirst && hasLast) return 3;
    if (hasFirst || hasLast) return 1;
    return 0;
  }

  const candidatePool: Array<{ source: string; candidate: ChildNameCandidate; score: number; priority: number }> = [];

  const addCandidate = (source: string, cand: ChildNameCandidate | null, priority: number) => {
    if (!cand) return;
    const score = getCandidateCompletenessScore(cand);
    if (score > 0) {
      candidatePool.push({ source, candidate: cand, score, priority });
    }
  };

  if (options?.childNameText) {
    addCandidate("childNameCrop", extractChildNameFromText(options.childNameText, true), 1);
  }
  if (options?.childSectionText) {
    addCandidate("childSectionCrop", extractChildNameFromText(options.childSectionText, false), 2);
  }
  if (options?.upperSectionText) {
    const upperSections = extractPsaSections(options.upperSectionText);
    addCandidate("upperSectionChild", extractChildNameFromText(upperSections.childSectionText || options.upperSectionText, false), 3);
    if (upperSections.childSectionText && upperSections.childSectionText !== options.upperSectionText) {
      addCandidate("upperSectionFull", extractChildNameFromText(options.upperSectionText, false), 3);
    }
  }
  if (sections.childSectionText) {
    addCandidate("docChildSection", extractChildNameFromText(sections.childSectionText, false), 4);
  }
  addCandidate("fullDoc", extractChildNameFromText(rawText, false), 5);

  let extractedChild: ChildNameCandidate | null = null;
  if (candidatePool.length > 0) {
    // Sort primarily by completeness score (descending), then by source priority (ascending)
    candidatePool.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // When upperSection yields a complete 3-part name (score >= 4), prefer upperSection over childNameCrop
      if (a.score >= 4 && b.score >= 4) {
        if (a.source.startsWith("upperSection") && b.source === "childNameCrop") return -1;
        if (b.source.startsWith("upperSection") && a.source === "childNameCrop") return 1;
      }
      return a.priority - b.priority;
    });

    extractedChild = { ...candidatePool[0].candidate };

    // If best candidate is missing middle name, check if another candidate with matching first/last has middle name
    if (!extractedChild.middleName) {
      const withMiddle = candidatePool.find(
        (c) =>
          c.candidate.middleName &&
          !/^(none|n\/?a|wala|-)$/i.test(c.candidate.middleName) &&
          c.candidate.firstName.toLowerCase() === extractedChild!.firstName.toLowerCase() &&
          (extractedChild!.lastName === "Unknown" || c.candidate.lastName.toLowerCase() === extractedChild!.lastName.toLowerCase())
      );
      if (withMiddle?.candidate.middleName) {
        extractedChild.middleName = withMiddle.candidate.middleName;
        const parts = [extractedChild.firstName, extractedChild.middleName, extractedChild.lastName !== "Unknown" ? extractedChild.lastName : ""].filter(Boolean);
        extractedChild.completeName = parts.join(" ") + (extractedChild.suffix ? ` ${extractedChild.suffix}` : "");
      }
    }
  }

  if (extractedChild) {
    firstName = extractedChild.firstName;
    middleName = extractedChild.middleName;
    lastName = extractedChild.lastName;
    suffix = extractedChild.suffix;
    completeName = extractedChild.completeName;
    isNameAmbiguous = Boolean(extractedChild.isAmbiguous);
  }

  // Derive Child Complete Name if not already set
  const isNameDetected =
    (firstName !== "Unknown" && firstName.length > 0) &&
    (lastName !== "Unknown" || (completeName !== undefined && completeName.length > 0));

  if (isNameDetected) {
    if (!completeName) {
      const parts = [firstName, middleName, lastName !== "Unknown" ? lastName : ""].filter(Boolean);
      completeName = parts.join(" ") + (suffix ? ` ${suffix}` : "");
    }
  } else {
    warnings.push("Child complete name could not be reliably extracted from PSA birth certificate.");
  }

  const formattedName = isNameDetected && lastName !== "Unknown"
    ? `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ""}${suffix ? ` ${suffix}` : ""}`
    : isNameDetected
    ? firstName
    : undefined;

  // 3. Sex
  let sex: "M" | "F" | undefined;

  const extractSexFromBlock = (textToSearch: string): "M" | "F" | undefined => {
    if (!textToSearch) return undefined;
    let sexSectionText = textToSearch;
    const sexAnchorMatch = textToSearch.match(/(?:\b2\.\s*sex\b|\bkasarian\b)/i);
    if (sexAnchorMatch && sexAnchorMatch.index !== undefined) {
      const afterSex = textToSearch.slice(sexAnchorMatch.index);
      const dobAnchorMatch = afterSex.match(/(?:\b3\.\s*date\b|\bdate\s*of\s*birth\b|\bpetsa\b|\b4\.\s*place\b|\bplace\s*of\s*birth\b)/i);
      sexSectionText = dobAnchorMatch && dobAnchorMatch.index !== undefined
        ? afterSex.slice(0, dobAnchorMatch.index)
        : afterSex.slice(0, 300);
    }

    // Step 1: Multiline line-by-line inspection of sexSectionText for checkmark preceding Male/Female
    const sexLines = sexSectionText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let i = 0; i < sexLines.length; i++) {
      const curr = sexLines[i];
      const isCheck = /^\[?[xX✓vV\/\*]\]?$/.test(curr);
      if (isCheck && i + 1 < sexLines.length) {
        const nextLine = sexLines[i + 1];
        const nextNextLine = i + 2 < sexLines.length ? sexLines[i + 2] : "";
        if (
          /^(?:1\s*)?(?:male|malo|mal|ma[il]e|lalaki)\b/i.test(nextLine) ||
          (nextLine === "1" && /^(?:male|malo|mal|ma[il]e|lalaki)\b/i.test(nextNextLine))
        ) {
          return "M";
        }
        if (
          /^(?:2\s*)?(?:female|femalo|fem|fema[il]e|babae)\b/i.test(nextLine) ||
          (nextLine === "2" && /^(?:female|femalo|fem|fema[il]e|babae)\b/i.test(nextNextLine))
        ) {
          return "F";
        }
      }
    }

    // Step 2: Proximity regex detection for checkmark/X and 1 Male/Malo vs 2 Female/Femalo
    const maleChecked =
      /(?:(?:\[[xX✓vV\/\*]\]|\([xX✓vV\/\*]\)|[xX✓vV])\s*[\r\n\s]*_?\s*(?:1\s*)?(?:male|malo|mal|ma[il]e|lalaki)\b|1\s*[\r\n\s]*_?\s*(?:\[[xX✓vV\/\*]\]|\([xX✓vV\/\*]\)|[xX✓vV])\s*(?:male|malo|mal|ma[il]e|lalaki)\b|1\s*(?:male|malo|mal|ma[il]e|lalaki)\b\s*[\r\n\s]*(?:\[[xX✓vV\/\*]\]|\([xX✓vV\/\*]\)|[xX✓vV])|\bx_?1\s*(?:male|malo|mal|ma[il]e|lalaki)\b|\b(?:male|malo|mal|ma[il]e|lalaki)\s*[xX✓vV]|\b1\s*(?:male|malo|mal|ma[il]e|lalaki)\s+(?:2\s*(?:female|femalo|fem|fema[il]e|babae)\s*)?\[\s*\]|\b(?:2\.\s*sex|sex|kasarian)[:\s\-_]*(?:male|malo|mal|ma[il]e|lalaki)\b)/i.test(
        sexSectionText
      );
    const femaleChecked =
      /(?:(?:\[[xX✓vV\/\*]\]|\([xX✓vV\/\*]\)|[xX✓vV])\s*[\r\n\s]*_?\s*(?:2\s*)?(?:female|femalo|fem|fema[il]e|babae)\b|2\s*[\r\n\s]*_?\s*(?:\[[xX✓vV\/\*]\]|\([xX✓vV\/\*]\)|[xX✓vV])\s*(?:female|femalo|fem|fema[il]e|babae)\b|2\s*(?:female|femalo|fem|fema[il]e|babae)\b\s*[\r\n\s]*(?:\[[xX✓vV\/\*]\]|\([xX✓vV\/\*]\)|[xX✓vV])|\bx_?2\s*(?:female|femalo|fem|fema[il]e|babae)\b|\b(?:female|femalo|fem|fema[il]e|babae)\s*[xX✓vV]|\b2\s*(?:female|femalo|fem|fema[il]e|babae)\s*\[[xX✓vV\/\*]\]|\b(?:2\.\s*sex|sex|kasarian)[:\s\-_]*(?:female|femalo|fem|fema[il]e|babae)\b)/i.test(
        sexSectionText
      );

    if (maleChecked && !femaleChecked) {
      return "M";
    } else if (femaleChecked && !maleChecked) {
      return "F";
    }

    // Look for explicit word following "2. SEX" or "SEX:"
    const sexMatch = sexSectionText.match(
      /(?:2\.\s*sex|sex|kasarian)[:\s\-_]*(?:1\s*|2\s*|\[[xX✓vV\/\*\s]*\]|\([xX✓vV\/\*\s]*\))*\s*(male|malo|female|femalo|mal|fem|maie|lalaki|babae)\b/i
    );
    if (sexMatch) {
      const s = sexMatch[1].toUpperCase();
      if (s.startsWith("M") || s === "LALAKI") return "M";
      else if (s.startsWith("F") || s === "BABAE") return "F";
    }

    return undefined;
  };

  // Extract sex preferring upperSectionText, then childSectionText, docChildSection, and finally fullText
  if (options?.upperSectionText) {
    sex = extractSexFromBlock(options.upperSectionText);
  }
  if (!sex && options?.childSectionText) {
    sex = extractSexFromBlock(options.childSectionText);
  }
  if (!sex && sections.childSectionText) {
    sex = extractSexFromBlock(sections.childSectionText);
  }
  if (!sex && rawText) {
    sex = extractSexFromBlock(rawText);
  }
  if (!sex) {
    warnings.push("Sex could not be reliably extracted from PSA birth certificate.");
  }

  // 4. Date of Birth (No invented fallback!)
  let birthDate: string | undefined;
  const dobSearchText = options?.childSectionText || options?.upperSectionText || sections.childSectionText || rawText;
  // Clean out Form 102 parenthetical labels like "(Day)", "(Month)", "(Year)", "(Araw)", "(Buwan)", "(Taon)"
  const cleanDobText = dobSearchText.replace(/\(\s*(?:day|month|year|araw|buwan|taon)\s*\)/gi, " ");

  const dobMatch = cleanDobText.match(
    /(?:date\s*of\s*birth|petsa\s*ng\s*kapanganakan|3\.\s*date)[:\s\-_]*([a-zA-Z0-9\s\,\/\-]+?)(?=(?:\s*(?:place|lugar|kasarian|sex|4\.\s*place|5\.\s*type|6\.\s*maiden|mother|ina|$)))/i
  );
  if (dobMatch) {
    const parsed = parseFlexibleDate(dobMatch[1].trim());
    if (parsed) birthDate = parsed;
  }
  if (!birthDate) {
    // Search for date patterns like "14 August 2007", "August 14, 2007", "08/14/2007", or "2007-08-14" in cleaned text
    const textDate =
      cleanDobText.match(/\b([0-9]{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{4})\b/i) ||
      cleanDobText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2}),?\s+([0-9]{4})\b/i) ||
      cleanDobText.match(/\b([0-9]{4})[\/-](0[1-9]|1[0-2])[\/-](0[1-9]|[12][0-9]|3[01])\b/) ||
      cleanDobText.match(/\b(0[1-9]|1[0-2])[\/-](0[1-9]|[12][0-9]|3[01])[\/-]([0-9]{4})\b/);
    if (textDate) {
      birthDate = parseFlexibleDate(textDate[0]) || undefined;
    }
  }
  if (!birthDate) {
    warnings.push("Date of birth could not be reliably extracted from PSA birth certificate.");
  }

  // 5. Parents (Mother & Father) — Strictly isolated to their respective document sections
  let motherMaidenName: string | undefined;
  const motherCandidateText = options?.upperSectionText || sections.motherSectionText || rawText;
  motherMaidenName = extractParentNameFromSection(
    motherCandidateText,
    /(?:\b(?:6\.\s*)?maiden\s*name\b|\bmother(?:\'?s?\s*(?:maiden\s*)?name)?\b|\bpangalan\s*ng\s*ina\b|\bina\b)/i,
    /(?:\b(?:7\.\s*)?citizenship\b|\bpagkamamamayan\b|\b(?:8\.\s*)?religion\b|\brelihiyon\b|\b(?:9\.\s*)?occupation\b|\bhanapbuhay\b|\b13\.\s*name\b|\bfather\b)/i
  );
  if (!motherMaidenName) {
    warnings.push("Mother's name could not be reliably extracted from PSA birth certificate.");
  }

  let fatherName: string | undefined;
  const fatherCandidateText = options?.upperSectionText || sections.fatherSectionText || rawText;
  fatherName = extractParentNameFromSection(
    fatherCandidateText,
    /(?:\b13\.\s*name(?:\s*of\s*father)?\b|\bname\s*of\s*father\b|\bfather(?:\'?s?\s*name)?\b|\bpangalan\s*ng\s*ama\b|\bama\b)/i,
    /(?:\b(?:14\.\s*)?citizenship\b|\bpagkamamamayan\b|\b(?:15\.\s*)?religion\b|\brelihiyon\b|\b(?:16\.\s*)?occupation\b|\bhanapbuhay\b|\b(?:20\.\s*)?marriage\b|\bkasal\b)/i
  );
  if (!fatherName) {
    warnings.push("Father's name could not be reliably extracted from PSA birth certificate.");
  }

  // 6. Place of Birth
  const birthPlace: { hospital?: string; city_municipality?: string; province?: string; raw?: string } = {};
  const placeSearchText = options?.childSectionText || sections.childSectionText || rawText;
  const placeMatch = placeSearchText.match(
    /(?:place\s*of\s*birth|lugar\s*ng\s*kapanganakan)[:\s]*([a-zA-Z0-9\s\,\.\-]+?)(?:\s*(?:mother|ina|date|petsa|citizenship|5\.\s*type|$|\n))/i
  );
  if (placeMatch) {
    const clean = placeMatch[1].replace(/[|*_`]+/g, "").trim();
    if (clean && clean.length > 2) {
      birthPlace.city_municipality = clean;
      birthPlace.raw = clean;
    }
  }

  // 7. Field recognition & handwriting classification
  let fieldRecognition: Record<string, FieldRecognitionClassification> | undefined;
  let recognitionSummary: DocumentRecognitionSummary | undefined;

  if (rawLayout) {
    fieldRecognition = {};
    if (registryNumber) {
      fieldRecognition.registry_number = classifyFieldRecognition(registryNumber, rawLayout);
    }
    if (firstName && firstName !== "Unknown") {
      fieldRecognition.first_name = classifyFieldRecognition(firstName, rawLayout);
    }
    if (lastName && lastName !== "Unknown") {
      fieldRecognition.last_name = classifyFieldRecognition(lastName, rawLayout);
    }
    if (birthDate) {
      fieldRecognition.birth_date = classifyFieldRecognition(birthDate, rawLayout);
    }
    if (motherMaidenName) {
      fieldRecognition.mother_maiden_name = classifyFieldRecognition(motherMaidenName, rawLayout);
    }
    if (fatherName) {
      fieldRecognition.father_name = classifyFieldRecognition(fatherName, rawLayout);
    }

    recognitionSummary = buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read");

    const hasHandwrittenIdentity = Object.values(fieldRecognition).some((f) => f.is_handwritten);
    if (hasHandwrittenIdentity) {
      warnings.push(
        "PSA document contains handwritten civil registry entries recognized via ICR. Teacher verification recommended."
      );
    }
  }

  // 8. Extraction status map calculation & honest per-field confidence percentage (0 to 100)
  const isConfidenceGood = ocrConfidence >= 0.85;
  const baseConfidencePct = Math.round(
    typeof ocrConfidence === "number" && !isNaN(ocrConfidence)
      ? ocrConfidence > 1
        ? ocrConfidence
        : ocrConfidence * 100
      : 95
  );

  const computeFieldConfidence = (
    value: string | undefined,
    status: FieldStatus,
    isAmbiguous?: boolean
  ): number => {
    if (!value || status === "not_detected" || value === "Unknown" || value.trim().length === 0) {
      return 0;
    }

    let matchedWordConfs: number[] = [];
    if (rawLayout && Array.isArray(rawLayout.pages)) {
      const valueTokens = value
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9]/g, ""))
        .filter((t) => t.length >= 2);

      for (const page of rawLayout.pages) {
        if (Array.isArray(page.words)) {
          for (const word of page.words) {
            const cleanWord = (word.content || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if (valueTokens.includes(cleanWord) && typeof word.confidence === "number") {
              matchedWordConfs.push(word.confidence);
            }
          }
        }
      }
    }

    let fieldConf: number;
    if (matchedWordConfs.length > 0) {
      const avg = matchedWordConfs.reduce((a, b) => a + b, 0) / matchedWordConfs.length;
      fieldConf = Math.round(avg > 1 ? avg : avg * 100);
    } else {
      fieldConf = baseConfidencePct;
    }

    if (isAmbiguous || status === "needs_verification") {
      fieldConf = Math.min(fieldConf, 74);
      fieldConf = Math.max(fieldConf, 60);
    } else if (status === "extracted") {
      fieldConf = Math.min(100, Math.max(fieldConf, 85));
    }

    return Math.min(100, Math.max(0, Math.round(fieldConf)));
  };

  const completeNameStatus: FieldStatus = isNameDetected
    ? isNameAmbiguous
      ? "needs_verification"
      : isConfidenceGood
      ? "extracted"
      : "needs_verification"
    : "not_detected";

  const firstNameStatus: FieldStatus =
    firstName !== "Unknown" && firstName.length > 0
      ? isNameAmbiguous
        ? "needs_verification"
        : isConfidenceGood
        ? "extracted"
        : "needs_verification"
      : "not_detected";

  const middleNameStatus: FieldStatus =
    middleName && middleName.length > 0 && !/^(none|n\/?a|wala|-)$/i.test(middleName)
      ? isNameAmbiguous
        ? "needs_verification"
        : isConfidenceGood
        ? "extracted"
        : "needs_verification"
      : "not_detected";

  const lastNameStatus: FieldStatus =
    lastName !== "Unknown" && lastName.length > 0
      ? isNameAmbiguous
        ? "needs_verification"
        : isConfidenceGood
        ? "extracted"
        : "needs_verification"
      : "not_detected";

  const birthDateStatus: FieldStatus =
    birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)
      ? "extracted"
      : birthDate
      ? isConfidenceGood
        ? "extracted"
        : "needs_verification"
      : "not_detected";

  const sexStatus: FieldStatus = sex ? "extracted" : "not_detected";
  const birthPlaceStatus: FieldStatus = birthPlace.city_municipality ? "extracted" : "not_detected";
  const motherNameStatus: FieldStatus = motherMaidenName ? "extracted" : "not_detected";
  const fatherNameStatus: FieldStatus = fatherName ? "extracted" : "not_detected";
  const registryNumberStatus: FieldStatus = registryNumber ? "extracted" : "not_detected";

  const motherItem: PsaFieldStatusItem = {
    status: motherNameStatus,
    value: motherMaidenName,
    confidence: computeFieldConfidence(motherMaidenName, motherNameStatus),
  };

  const fieldStatuses: PsaFieldStatusMap = {
    complete_name: {
      status: completeNameStatus,
      value: completeName,
      confidence: computeFieldConfidence(completeName, completeNameStatus, isNameAmbiguous),
      notes: isNameDetected
        ? isNameAmbiguous
          ? "Child complete name detected; component separation requires review"
          : undefined
        : "Child complete name not detected in document",
    },
    first_name: {
      status: firstNameStatus,
      value: firstName !== "Unknown" ? firstName : undefined,
      confidence: computeFieldConfidence(firstName !== "Unknown" ? firstName : undefined, firstNameStatus, isNameAmbiguous),
      notes: isNameAmbiguous ? "Review first name separation" : undefined,
    },
    middle_name: {
      status: middleNameStatus,
      value: middleName,
      confidence: computeFieldConfidence(
        middleName && !/^(none|n\/?a|wala|-)$/i.test(middleName) ? middleName : undefined,
        middleNameStatus,
        isNameAmbiguous
      ),
      notes: middleName ? (isNameAmbiguous ? "Review middle name separation" : undefined) : "Middle name is optional / not detected",
    },
    last_name: {
      status: lastNameStatus,
      value: lastName !== "Unknown" ? lastName : undefined,
      confidence: computeFieldConfidence(lastName !== "Unknown" ? lastName : undefined, lastNameStatus, isNameAmbiguous),
      notes: isNameAmbiguous ? "Review last name separation" : undefined,
    },
    birth_date: {
      status: birthDateStatus,
      value: birthDate,
      confidence: computeFieldConfidence(birthDate, birthDateStatus),
    },
    sex: {
      status: sexStatus,
      value: sex,
      confidence: computeFieldConfidence(sex, sexStatus),
    },
    birth_place: {
      status: birthPlaceStatus,
      value: birthPlace.city_municipality,
      confidence: computeFieldConfidence(birthPlace.city_municipality, birthPlaceStatus),
    },
    mother_name: motherItem,
    mother_maiden_name: motherItem,
    father_name: {
      status: fatherNameStatus,
      value: fatherName,
      confidence: computeFieldConfidence(fatherName, fatherNameStatus),
    },
    registry_number: {
      status: registryNumberStatus,
      value: registryNumber,
      confidence: computeFieldConfidence(registryNumber, registryNumberStatus),
    },
  };

  return {
    identity: {
      registry_number: registryNumber,
      certificate_number: registryNumber,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      complete_name: completeName,
      formatted_name: formattedName,
      suffix,
      sex: sex,
      birth_date: birthDate || "",
      birth_place: birthPlace,
      mother_maiden_name: motherMaidenName,
      mother_name: motherMaidenName,
      father_name: fatherName,
    },
    confidence: ocrConfidence,
    field_statuses: fieldStatuses,
    field_recognition: fieldRecognition,
    recognition_summary: recognitionSummary,
    warnings,
  };
}

function parseFlexibleDate(dateStr: string): string | null {
  const cleaned = dateStr.replace(/\s+/g, " ").trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // MM/DD/YYYY
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }

  // Month DD, YYYY
  const monthMap: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  // DD Month YYYY (e.g. 15 June 2009 or 14 August 2007)
  const dmyMatch = cleaned.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/i);
  if (dmyMatch) {
    const month = monthMap[dmyMatch[2].toLowerCase()];
    if (month) {
      const day = dmyMatch[1].padStart(2, "0");
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }
  }

  // Month DD, YYYY (e.g. June 15, 2009)
  const wordMatch = cleaned.match(/([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (wordMatch) {
    const month = monthMap[wordMatch[1].toLowerCase()];
    if (month) {
      const day = wordMatch[2].padStart(2, "0");
      const year = wordMatch[3];
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

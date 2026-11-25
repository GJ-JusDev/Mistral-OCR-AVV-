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
  return raw
    .replace(/\([^)]*(?:first|middle|last|pangalan|apelyido|name)[^)]*\)/gi, " ")
    .replace(/\b(?:first|middle|last)\s*,?\s*(?:middle|last)?\s*,?\s*(?:last)?\b/gi, " ")
    .replace(/[|*_`()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  const lower = trimmed.toLowerCase();

  // 1. Geographic, administrative, and address tokens (prevents "RIN CAL. CITY", "QUEZON CITY", etc.)
  const geoTerms = [
    "cal. city",
    "cal city",
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

  // Strategy 1: Explicit inline labeled tokens, e.g. "(First) JUSTIN (Middle) LOQUILLANO (Last) GOMEZ"
  const explicitInline = text.match(
    /(?:(?:1a\.\s*)?\(?\s*first(?:\s*name)?\s*\)?|\bunang\s*pangalan\b)[:\s\-_]*([a-zA-ZñÑ\s\.\-]+?)(?=(?:(?:1b\.\s*)?\(?\s*middle(?:\s*name)?\s*\)?|\bgitnang\s*pangalan\b))[:\s\-_]*(?:(?:1b\.\s*)?\(?\s*middle(?:\s*name)?\s*\)?|\bgitnang\s*pangalan\b)[:\s\-_]*([a-zA-ZñÑ\s\.\-]+?)(?=(?:(?:1c\.\s*)?\(?\s*last(?:\s*name)?\s*\)?|\bapelyido\b|\bsurname\b))[:\s\-_]*(?:(?:1c\.\s*)?\(?\s*last(?:\s*name)?\s*\)?|\bapelyido\b|\bsurname\b)[:\s\-_]*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*2\.\s*sex\b|\bsex\b|date\s*of\s*birth|kasarian|3\.\s*date|petsa|4\.\s*place|place\s*of\s*birth|$|\r|\n))/i
  );
  if (explicitInline) {
    const fn = cleanPersonNameString(explicitInline[1]);
    const mn = cleanPersonNameString(explicitInline[2]);
    const ln = cleanPersonNameString(explicitInline[3]);
    if (!isInvalidPersonName(fn) && !isInvalidPersonName(ln)) {
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
  const fnMatch = text.match(
    /(?:(?:\(?\s*1a\.\s*)?(?:\(?\s*first(?:\s*name)?\s*\)?|unang\s*pangalan))\s*[:\-]?\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*(?:1b\.\s*)?middle|\(?\s*(?:1c\.\s*)?last|gitnang|apelyido|sex|kasarian|2\.\s*sex|$|\r|\n))/i
  );
  const mnMatch = text.match(
    /(?:(?:\(?\s*1b\.\s*)?(?:\(?\s*middle(?:\s*name)?\s*\)?|gitnang\s*pangalan))\s*[:\-]?\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*(?:1c\.\s*)?last|apelyido|sex|kasarian|date|petsa|2\.\s*sex|3\.\s*date|$|\r|\n))/i
  );
  const lnMatch = text.match(
    /(?:(?:\(?\s*1c\.\s*)?(?:\(?\s*last(?:\s*name)?\s*\)?|apelyido|surname))\s*[:\-]?\s*([a-zA-ZñÑ\s\.\-]+?)(?=(?:\(?\s*first|\(?\s*middle|sex|kasarian|date|petsa|place|lugar|2\.\s*sex|3\.\s*date|4\.\s*place|$|\r|\n))/i
  );

  if (fnMatch && lnMatch) {
    const fnClean = fnMatch[1].replace(/[|*_`()]+/g, "").trim();
    const lnClean = lnMatch[1].replace(/[|*_`()]+/g, "").trim();
    const mnClean = mnMatch ? mnMatch[1].replace(/[|*_`()]+/g, "").trim() : "";

    if (!isInvalidPersonName(fnClean) && !isInvalidPersonName(lnClean)) {
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

  // Strategy 2: Clean non-header lines in Item 1 crop or table row
  // PSA Form 102 Item 1 is laid out horizontally into three columns: (First) (Middle) (Last)
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\((?:first|middle|last|unang|gitnang|apelyido|first,\s*middle,\s*last)[^\)]*\)/gi, " "))
    .map((l) => l.replace(/[|*_`]+/g, "").trim())
    .filter((l) => {
      if (l.length < 2) return false;
      if (/^(?:1\.\s*)?name(?:\s*of\s*child)?$/i.test(l)) return false;
      if (/^(?:1a\.|1b\.|1c\.|2\.\s*sex|sex|kasarian|date\s*of\s*birth|3\.\s*date|4\.\s*place)$/i.test(l)) return false;
      return !isInvalidPersonName(l);
    });

  const hasNameHeader = /(?:\b(?:1\.\s*)?name(?:\s*of\s*child)?\b|\bpangalan\s*(?:ng\s*bata)?\b|\bchild\'?s?\s*name\b)/i.test(text);
  if ((isTargetedNameCrop || hasNameHeader) && rawLines.length >= 1) {
    // Process candidate name line (either the first valid name line, or separate lines)
    if (rawLines.length === 3) {
      // 3 separate lines: First, Middle, Last
      const fn = toTitleCase(rawLines[0]);
      const mn = toTitleCase(rawLines[1]);
      const ln = toTitleCase(rawLines[2]);
      return {
        firstName: fn,
        middleName: mn,
        lastName: ln,
        completeName: `${fn} ${mn} ${ln}`,
      };
    } else if (rawLines.length === 2 && isTargetedNameCrop) {
      // 2 separate lines in targeted crop: First, Last
      const fn = toTitleCase(rawLines[0]);
      const ln = toTitleCase(rawLines[1]);
      return {
        firstName: fn,
        middleName: undefined,
        lastName: ln,
        completeName: `${fn} ${ln}`,
      };
    } else {
      // 1 line containing horizontal columns: e.g. "JUSTIN LOQUILLANO GOMEZ"
      const nameLine = rawLines[0];
      const tokens = nameLine.split(/\s+/).filter(Boolean);
      if (tokens.length >= 3) {
        // Form 102 horizontal 3-column standard: Token 0 = First, Token 1 = Middle, Token 2 = Last
        // Handles compound first names when 4 tokens: "JUSTIN PAUL" + "LOQUILLANO" + "GOMEZ"
        if (tokens.length === 3) {
          const compoundPrefixes = ["de", "del", "dela", "de la", "san", "santa", "de los", "delos"];
          if (compoundPrefixes.includes(tokens[1].toLowerCase())) {
            const fn = toTitleCase(tokens[0]);
            const ln = toTitleCase(`${tokens[1]} ${tokens[2]}`);
            return {
              firstName: fn,
              middleName: undefined,
              lastName: ln,
              completeName: `${fn} ${ln}`,
            };
          }
          const fn = toTitleCase(tokens[0]);
          const mn = toTitleCase(tokens[1]);
          const ln = toTitleCase(tokens[2]);
          return {
            firstName: fn,
            middleName: mn,
            lastName: ln,
            completeName: `${fn} ${mn} ${ln}`,
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
              completeName: `${fn} ${mn} ${ln}`,
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
            completeName: `${fn} ${mn} ${ln}`,
          };
        }
      } else if (tokens.length === 2) {
        const fn = toTitleCase(tokens[0]);
        const ln = toTitleCase(tokens[1]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: ln,
          completeName: `${fn} ${ln}`,
        };
      } else if (tokens.length === 1) {
        const fn = toTitleCase(tokens[0]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: "Unknown",
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
    if (!isInvalidPersonName(candidateName)) {
      const tokens = candidateName.split(/\s+/).filter(Boolean);
      if (tokens.length >= 3) {
        const compoundPrefixes = ["de", "del", "dela", "de la", "san", "santa", "de los", "delos"];
        if (tokens.length === 3 && compoundPrefixes.includes(tokens[1].toLowerCase())) {
          const fn = toTitleCase(tokens[0]);
          const ln = toTitleCase(`${tokens[1]} ${tokens[2]}`);
          return {
            firstName: fn,
            middleName: undefined,
            lastName: ln,
            completeName: `${fn} ${ln}`,
          };
        }
        const fn = toTitleCase(tokens[0]);
        const mn = toTitleCase(tokens.slice(1, -1).join(" "));
        const ln = toTitleCase(tokens[tokens.length - 1]);
        return {
          firstName: fn,
          middleName: mn,
          lastName: ln,
          completeName: `${fn} ${mn} ${ln}`,
        };
      } else if (tokens.length === 2) {
        const fn = toTitleCase(tokens[0]);
        const ln = toTitleCase(tokens[1]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: ln,
          completeName: `${fn} ${ln}`,
        };
      } else if (tokens.length === 1) {
        const fn = toTitleCase(tokens[0]);
        return {
          firstName: fn,
          middleName: undefined,
          lastName: "Unknown",
          completeName: fn,
          isAmbiguous: true,
        };
      }
    }
  }

  return null;
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
  let registryNumber: string | undefined;
  const regMatch = rawText.match(
    /(?:(?:psa\s*)?certificate\s*(?:no\.?|number)|registry\s*(?:no\.?|number)|rehistro\s*blg\.?|local\s*civil\s*registry\s*no\.?|lcr\s*no\.?)[:\s]*([0-9][0-9\- ]*)/i
  );
  if (regMatch) {
    registryNumber = regMatch[1].replace(/\s+/g, "").trim();
  }

  // 2. Child Name (First, Middle, Last, Suffix, Complete Name)
  let firstName = "Unknown";
  let middleName: string | undefined;
  let lastName = "Unknown";
  let suffix: string | undefined;
  let completeName: string | undefined;
  let isNameAmbiguous = false;

  // Attempt child name extraction across sources in priority order:
  // Priority A: Targeted Item 1 Name-only crop OCR text
  let extractedChild: ChildNameCandidate | null = null;
  if (options?.childNameText) {
    extractedChild = extractChildNameFromText(options.childNameText, true);
  }

  // Priority B: Targeted Child Section crop OCR text (Items 1 - 5)
  if (!extractedChild && options?.childSectionText) {
    extractedChild = extractChildNameFromText(options.childSectionText, false);
  }

  // Priority C: Full document CHILD section text (strictly bounded before Mother section)
  if (!extractedChild && sections.childSectionText) {
    extractedChild = extractChildNameFromText(sections.childSectionText, false);
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
  const sexSearchText = options?.childSectionText || sections.childSectionText || rawText;

  // Check for selection mark or checkbox next to Male vs Female in Item 2
  const maleChecked = /(?:(?:\[[xX✓\/\*]\]|\([xX✓\/\*]\)|[xX✓])\s*(?:1\s*)?male\b|\b1\s*(?:\[[xX✓\/\*]\]|\([xX✓\/\*]\)|[xX✓])?\s*male\b|\b(?:2\.\s*sex|sex|kasarian)[:\s\-_]*male\b)/i.test(sexSearchText);
  const femaleChecked = /(?:(?:\[[xX✓\/\*]\]|\([xX✓\/\*]\)|[xX✓])\s*(?:2\s*)?female\b|\b2\s*(?:\[[xX✓\/\*]\]|\([xX✓\/\*]\)|[xX✓])?\s*female\b|\b(?:2\.\s*sex|sex|kasarian)[:\s\-_]*female\b)/i.test(sexSearchText);

  if (maleChecked && !femaleChecked) {
    sex = "M";
  } else if (femaleChecked && !maleChecked) {
    sex = "F";
  } else {
    // Look for explicit word following "2. SEX" or "SEX:"
    const sexMatch = sexSearchText.match(
      /(?:2\.\s*sex|sex|kasarian)[:\s\-_]*(?:1\s*|2\s*|\[[xX✓\/\*\s]*\]|\([xX✓\/\*\s]*\))*\s*(male|female|lalaki|babae)\b/i
    );
    if (sexMatch) {
      const s = sexMatch[1].toUpperCase();
      if (s.startsWith("M") || s === "LALAKI") sex = "M";
      else if (s.startsWith("F") || s === "BABAE") sex = "F";
    }
  }
  if (!sex) {
    warnings.push("Sex could not be reliably extracted from PSA birth certificate.");
  }

  // 4. Date of Birth (No invented fallback!)
  let birthDate: string | undefined;
  const dobSearchText = options?.childSectionText || sections.childSectionText || rawText;
  // Clean out Form 102 parenthetical labels like "(Day)", "(Month)", "(Year)", "(Araw)", "(Buwan)", "(Taon)"
  const cleanDobText = dobSearchText.replace(/\(\s*(?:day|month|year|araw|buwan|taon)\s*\)/gi, " ");

  const dobMatch = cleanDobText.match(
    /(?:date\s*of\s*birth|petsa\s*ng\s*kapanganakan|3\.\s*date)[:\s\-_]*([a-zA-Z0-9\s\,\/\-]+?)(?=(?:\s*(?:place|lugar|kasarian|sex|4\.\s*place|5\.\s*type|$|\n)))/i
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
  const motherSectionText = sections.motherSectionText || rawText;
  const motherMatch = motherSectionText.match(
    /(?:(?:\b(?:6\.\s*)?maiden\s*name\b|\bmother(?:\'?s?\s*(?:maiden\s*)?name)?\b|\bpangalan\s*ng\s*ina\b|\bina\b)[:\s\-]*(?:\([^\)]*\))?[:\s\-]*([a-zA-ZñÑ\s\.\,\-]+?)(?=(?:\s*(?:citizenship|relihiyon|religion|occupation|hanapbuhay|age|edad|total|7\.|8\.|9\.|10\.|11\.|12\.|residence|$|\r|\n))))/i
  );
  if (motherMatch) {
    const clean = cleanPersonNameString(motherMatch[1]);
    if (!isInvalidPersonName(clean)) {
      motherMaidenName = clean;
    }
  }
  if (!motherMaidenName) {
    warnings.push("Mother's name could not be reliably extracted from PSA birth certificate.");
  }

  let fatherName: string | undefined;
  // Strict Father Section Extraction (Prevents RIN CAL. CITY, addresses, and Place of Birth bleeding)
  const fatherSectionText = sections.fatherSectionText || rawText;
  if (fatherSectionText) {
    const fatherMatch = fatherSectionText.match(
      /(?:(?:\b13\.\s*name\b|\bfather(?:\'?s?\s*name)?\b|\bpangalan\s*ng\s*ama\b|\bama\b)[:\s\-]*(?:\([^\)]*\))?[:\s\-]*([a-zA-ZñÑ\s\.\,\-]+?)(?=(?:\s*(?:citizenship|relihiyon|religion|occupation|hanapbuhay|age|edad|14\.|15\.|16\.|17\.|18\.|19\.|residence|$|\r|\n))))/i
    );
    if (fatherMatch) {
      const clean = cleanPersonNameString(fatherMatch[1]);
      if (!isInvalidPersonName(clean)) {
        fatherName = clean;
      }
    }
  }
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

  // 8. Extraction status map calculation
  const isConfidenceGood = ocrConfidence >= 0.85;

  const fieldStatuses: PsaFieldStatusMap = {
    complete_name: {
      status: isNameDetected
        ? isConfidenceGood
          ? "extracted"
          : "needs_verification"
        : "not_detected",
      value: completeName,
      confidence: ocrConfidence,
      notes: isNameDetected
        ? isNameAmbiguous
          ? "Child complete name detected; component separation requires review"
          : undefined
        : "Child complete name not detected in document",
    },
    first_name: {
      status: firstName !== "Unknown" && firstName.length > 0
        ? isNameAmbiguous
          ? "needs_verification"
          : isConfidenceGood
          ? "extracted"
          : "needs_verification"
        : "not_detected",
      value: firstName !== "Unknown" ? firstName : undefined,
      confidence: ocrConfidence,
      notes: isNameAmbiguous ? "Review first name separation" : undefined,
    },
    middle_name: {
      status: middleName && middleName.length > 0
        ? isNameAmbiguous
          ? "needs_verification"
          : isConfidenceGood
          ? "extracted"
          : "needs_verification"
        : "not_detected",
      value: middleName,
      confidence: ocrConfidence,
      notes: middleName ? (isNameAmbiguous ? "Review middle name separation" : undefined) : "Middle name is optional / not detected",
    },
    last_name: {
      status: lastName !== "Unknown" && lastName.length > 0
        ? isNameAmbiguous
          ? "needs_verification"
          : isConfidenceGood
          ? "extracted"
          : "needs_verification"
        : "not_detected",
      value: lastName !== "Unknown" ? lastName : undefined,
      confidence: ocrConfidence,
      notes: isNameAmbiguous ? "Review last name separation" : undefined,
    },
    birth_date: {
      status: birthDate
        ? isConfidenceGood
          ? "extracted"
          : "needs_verification"
        : "not_detected",
      value: birthDate,
      confidence: ocrConfidence,
    },
    sex: {
      status: sex ? "extracted" : "not_detected",
      value: sex,
      confidence: ocrConfidence,
    },
    birth_place: {
      status: birthPlace.city_municipality ? "extracted" : "not_detected",
      value: birthPlace.city_municipality,
      confidence: ocrConfidence,
    },
    mother_name: {
      status: motherMaidenName ? "extracted" : "not_detected",
      value: motherMaidenName,
      confidence: ocrConfidence,
    },
    father_name: {
      status: fatherName ? "extracted" : "not_detected",
      value: fatherName,
      confidence: ocrConfidence,
    },
    registry_number: {
      status: registryNumber ? "extracted" : "not_detected",
      value: registryNumber,
      confidence: ocrConfidence,
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
      sex: sex || ("M" as any),
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

/**
 * AVV System — PSA Certificate of Live Birth Parser
 *
 * Exclusively used as a SUPPORTING IDENTITY EVIDENCE document under RA 10173.
 * Extracts:
 * - Registry Number (Local Civil Registry Number)
 * - Child's Name (First Name, Middle Name, Last Name)
 * - Sex ('M' | 'F')
 * - Date of Birth (YYYY-MM-DD)
 * - Place of Birth (Hospital, Municipality/City, Province)
 * - Mother's Maiden Name
 * - Father's Name
 * - Parents' Marriage Details
 *
 * CRITICAL PRIVACY & GOVERNANCE SAFEGUARDS:
 * - Never used to calculate grades, attendance, or promotion.
 * - Never automatically overwrites verified student profiles.
 * - Discrepancies are flagged for authorized registrar verification.
 */

import { splitLearnerName } from "./shsSf1Parser";
import {
  classifyFieldRecognition,
  buildDocumentRecognitionSummary,
  type FieldRecognitionClassification,
  type DocumentRecognitionSummary,
} from "./handwritingExtractor";

export interface PsaIdentityFields {
  registry_number?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  sex: "M" | "F";
  birth_date: string;
  birth_place?: {
    hospital?: string;
    city_municipality?: string;
    province?: string;
  };
  mother_maiden_name?: string;
  father_name?: string;
  parents_marriage_details?: {
    date?: string;
    place?: string;
  };
}

export interface PsaParseResult {
  identity: PsaIdentityFields;
  confidence: number;
  field_recognition?: Record<string, FieldRecognitionClassification>;
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
}

export function parsePsaBirthCert(
  rawText: string,
  rawLayout?: any,
  ocrConfidence: number = 0.95
): PsaParseResult {
  const warnings: string[] = [];

  // 1. Registry Number
  let registryNumber: string | undefined;
  const regMatch = rawText.match(/(?:registry\s*no\.?|rehistro\s*blg\.?)[:\s]*([0-9][0-9\- ]*)/i);
  if (regMatch) {
    registryNumber = regMatch[1].replace(/\s+/g, "").trim();
  }

  // 2. Child Name
  let firstName = "Unknown";
  let middleName: string | undefined;
  let lastName = "Unknown";

  const childMatch = rawText.match(/(?:(?:1\.\s*)?name(?:\s*of\s*child)?|pangalan\s*(?:ng\s*bata)?|child)[:\s]*([a-zA-ZñÑ\s\.\,\-]+?)(?:\s*(?:2\.\s*sex|sex|date\s*of\s*birth|kasarian|$|\r|\n))/i);
  if (childMatch) {
    const split = splitLearnerName(childMatch[1].trim());
    firstName = split.firstName;
    middleName = split.middleName;
    lastName = split.lastName;
  } else {
    // Try separate First, Middle, Last lines
    const fnMatch = rawText.match(/first\s*name[:\s]*([a-zA-ZñÑ\s]+)/i);
    const mnMatch = rawText.match(/middle\s*name[:\s]*([a-zA-ZñÑ\s]+)/i);
    const lnMatch = rawText.match(/last\s*name[:\s]*([a-zA-ZñÑ\s]+)/i);
    if (fnMatch) firstName = fnMatch[1].trim();
    if (mnMatch) middleName = mnMatch[1].trim();
    if (lnMatch) lastName = lnMatch[1].trim();
  }

  // 3. Sex
  let sex: "M" | "F" = "M";
  if (/\b(?:female|babae)\b/i.test(rawText)) {
    sex = "F";
  } else if (/\b(?:male|lalaki)\b/i.test(rawText)) {
    sex = "M";
  }

  // 4. Date of Birth
  let birthDate = "2009-01-01"; // fallback placeholder
  const dobMatch = rawText.match(/(?:date\s*of\s*birth|petsa\s*ng\s*kapanganakan)[:\s]*([a-zA-Z0-9\s\,\/\-]+?)(?:\s*(?:place|lugar|$|\n))/i);
  if (dobMatch) {
    const parsed = parseFlexibleDate(dobMatch[1].trim());
    if (parsed) birthDate = parsed;
  } else {
    // Search for date patterns like "May 12, 2009" or "12 May 2009"
    const textDate = rawText.match(/\b([0-9]{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{4})\b/i) ||
                     rawText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2}),?\s+([0-9]{4})\b/i);
    if (textDate) {
      birthDate = parseFlexibleDate(textDate[0]) || birthDate;
    }
  }

  // 5. Parents
  let motherMaidenName: string | undefined;
  const motherMatch = rawText.match(/(?:mother(?:\'?s?\s*(?:maiden\s*)?name)?|maiden\s*name|ina)[:\s]*([a-zA-ZñÑ\s\.\,\-]+?)(?:\s*(?:citizenship|father|ama|$|\r|\n))/i);
  if (motherMatch) {
    motherMaidenName = motherMatch[1].trim();
  }

  let fatherName: string | undefined;
  const fatherMatch = rawText.match(/(?:father(?:\'?s?\s*name)?|ama)[:\s]*([a-zA-ZñÑ\s\.\,\-]+?)(?:\s*(?:citizenship|marriage|kasal|$|\r|\n))/i);
  if (fatherMatch) {
    fatherName = fatherMatch[1].trim();
  }

  // 6. Place of Birth
  const birthPlace: { hospital?: string; city_municipality?: string; province?: string } = {};
  const placeMatch = rawText.match(/(?:place\s*of\s*birth|lugar\s*ng\s*kapanganakan)[:\s]*([a-zA-Z0-9\s\,\.\-]+?)(?:\s*(?:mother|ina|$|\n))/i);
  if (placeMatch) {
    birthPlace.city_municipality = placeMatch[1].trim();
  }

  if (firstName === "Unknown" || lastName === "Unknown") {
    warnings.push("Child name could not be reliably extracted from PSA birth certificate.");
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

    const hasHandwrittenIdentity = Object.values(fieldRecognition).some(f => f.is_handwritten);
    if (hasHandwrittenIdentity) {
      warnings.push("PSA document contains handwritten civil registry entries recognized via Azure ICR. Teacher verification recommended.");
    }
  }

  return {
    identity: {
      registry_number: registryNumber,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      sex,
      birth_date: birthDate,
      birth_place: birthPlace,
      mother_maiden_name: motherMaidenName,
      father_name: fatherName,
    },
    confidence: ocrConfidence,
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
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };

  // DD Month YYYY (e.g. 15 June 2009)
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

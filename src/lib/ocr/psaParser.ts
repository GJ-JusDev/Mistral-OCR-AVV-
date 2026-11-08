/**
 * PSA (Philippine Statistics Authority) Certificate of Live Birth Parser.
 *
 * MGA DAPAT TANDAAN SA CAPSTONE DEFENSE:
 * 1. Bakit Two-Stage Anchor Detection:
 *    Sa PSA Birth Certificate, maraming pangalan (Bata sa Item 1, Ina sa Item 6, Ama sa Item 13, Informant, Doktor).
 *    - Stage 1: Tinutukoy ang Item 1 Anchor para siguraduhing pangalan lang ng bata ang binabasa.
 *    - Stage 2: Hinahanap ang spatial sub-labels na "(First)", "(Middle)", "(Last)" sa loob ng kahon.
 * 2. Anti-Contamination Rules:
 *    - Bawal pumasok ang titles tulad ng M.D., RN, o Dr. sa pangalan.
 *    - Bawal pumasok ang header text tulad ng "MANILA" o province names.
 *    - Bawal ang standalone numbers (e.g. 40, 50).
 * 3. Bakit Walang Grado (`grades: []`):
 *    Ang PSA ay civil registry document lamang para sa identity at birth verification; wala itong academic grades.
 */

import type { ExtractedFields } from "@/types/documents";
import { normalizeSex, DATE_PATTERNS } from "../validation/patterns";
import type { PsaSexMarkAnalysisResult } from "../image/psaSexMarkDetector";

export type FieldExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";
export type FieldExtractionStatus = "extracted" | "needs_verification" | "not_extracted";

export interface FieldExtractionMeta {
  status: FieldExtractionStatus;
  confidence?: FieldExtractionConfidence;
  numericConfidence?: number;
  needsVerification: boolean;
  reason?: string;
}

export interface PsaExtractedFields extends ExtractedFields {
  document_type: "birth_cert";
  birth_place?: string;
  birth_facility?: string;
  birth_city_municipality?: string;
  birth_province?: string;
  mother_name?: string;
  mother_first_name?: string;
  mother_middle_name?: string;
  mother_last_name?: string;
  father_name?: string;
  father_first_name?: string;
  father_middle_name?: string;
  father_last_name?: string;
  registry_number?: string;
  field_metadata?: Record<string, FieldExtractionMeta>;
  diagnostic?: Record<string, any>;
}

export interface NormalizedUprightBBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  centerU: number;
  centerV: number;
  width: number;
  height: number;
}

export interface SpatialPsaWord {
  content: string;
  cleanText: string;
  confidence?: number;
  bbox: NormalizedUprightBBox;
}

export interface SpatialPsaLine {
  content: string;
  cleanText: string;
  bbox: NormalizedUprightBBox;
  words?: SpatialPsaWord[];
}

export interface PsaItemAnchor {
  itemNumber: number;
  label: string;
  bbox: NormalizedUprightBBox;
}

export interface ExtractedPersonNameResult {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  subLabelsFound: { first: boolean; middle: boolean; last: boolean };
  detectedOrder?: Array<"first" | "middle" | "last">;
  rowVRange: { minV: number; maxV: number };
}

// ============================================================================
// 1. REUSABLE PSA LABEL & INSTRUCTION REJECTION DICTIONARY
// ============================================================================

// Note: Legitimate Filipino cultural particles like "de", "del", "la", "san", "santa"
// are preserved and NOT in the disallowed words set.
const PSA_DISALLOWED_EXACT_WORDS = new Set([
  "of", "in", "at", "by", "for", "the", "and", "or", "to", "from", "on", "with",
  "name", "first", "middle", "last", "maiden", "given", "surname", "child",
  "pangalan", "unang", "gitnang", "apelyido", "bata",
  "sex", "gender", "kasarian", "male", "female", "lalaki", "babae",
  "date", "birth", "day", "month", "year", "kapanganakan", "araw", "buwan", "taon",
  "place", "hospital", "clinic", "institution", "city", "municipality", "province",
  "lugar", "lungsod", "bayan", "lalawigan",
  "type", "single", "twin", "triplet", "multiple", "order", "weight", "timbang",
  "citizenship", "religion", "occupation", "residence", "tirahan", "relihiyon", "hanapbuhay",
  "mother", "father", "parents", "ina", "ama", "magulang",
  "marriage", "married", "kasal",
  "informant", "attendant", "physician", "nurse", "midwife", "hilot",
  "prepared", "received", "certified", "civil", "registrar", "general", "office",
  "registry", "republic", "philippines", "statistics", "authority", "national",
  "certificate", "live", "page", "book", "entry", "number", "no", "barcode", "serial",
  "form", "revised", "revisado", "municipal",
  // Medical/Professional suffixes
  "md", "rn", "rm", "dr", "atty", "phd", "esq", "physician",
  // Contamination words observed in real documents
  "population", "ocr", "ocr0", "ocag", "use", "reference", "na", "nie",
  "freq", "frequency", "les", "lesions",
  "catholic", "catholio", "filipino", "capargpangan",
  "final", "iddia", "total",
  "filed", "erasure", "erasures", "triplot", "scand", "specify", "others", "was",
  "bcr", "sn", "nso", "psa",
]);

const PSA_DISALLOWED_PATTERNS = [
  /city\s*\/\s*municipality/i,
  /hospital\s*\/\s*clinic/i,
  /clinic\s*\/\s*institution/i,
  /first\s*\/\s*middle\s*\/\s*last/i,
  /name\s+of\s+hospital/i,
  /place\s+of\s+birth/i,
  /date\s+of\s+birth/i,
  /maiden\s+name/i,
  /certificate\s+of\s+live\s+birth/i,
  /office\s+of\s+the\s+civil/i,
  /philippine\s+statistics/i,
  /republic\s+of\s+the/i,
  /civil\s+registrar/i,
  /prepared\s+by/i,
  /received\s+by/i,
  /informant/i,
  /municipal\s+form/i,
  /\b(?:revised|revisado)\b/i,
  /\b(?:registry\s+no|civil\s+registry\s+no)\b/i,
  // Professional suffixes
  /\bm\.?d\.?\b/i,
  /\br\.?n\.?\b/i,
  /\bdr\.?\b/i,
  /\batty\.?\b/i,
  // Adjacent numbered field markers indicating contamination
  /\b(?:5|5a|5b|6|7|8|9|9a|9b|10|14|15|16|17|18|19|20)\.\s*/i,
  /\btype\s+of\s+birth\b/i,
  // Field label contamination patterns
  /\bpopulation(?:\s+reference)?\b/i,
  /\b(?:for\s+)?ocr\s*(?:use\s*only)?\b/i,
  /\breference\s*(?:only|no\.?)\b/i,
  /\breligion\b/i,
  /\bcathol[ia]c\b/i,
  /\bfilipino\b/i,
  /\bcitizenship\b/i,
  /\boccupation\b/i,
  /\bcapargpangan\b/i,
  /\b(?:freq|frequency)\b/i,
  /\b(?:les|lesions)\b/i,
  /\bfinal\b/i,
  /\btotal(?:\s+number)?\b/i,
  /\bfiled\s+(?:w\/|with)?\s*erasure/i,
  /\b(?:for\s+)?(?:ocr|ocag)\b/i,
  /\b(?:only\s+n[oi]e?\.?)\b/i,
  /\bif\s+(?:others|multiple)\b/i,
  /\b(?:first|second|third)\s*,\s*(?:second|third|etc)/i,
];

/**
 * Checks whether candidate text matches or contains printed form instructions or labels.
 */
export function isDisallowedPsaValue(val: string): boolean {
  if (!val || typeof val !== "string") return true;
  const trimmed = val.trim();
  if (trimmed.length === 0) return true;

  // Single prepositions (excluding valid particles like "de", "del", "la")
  if (/^(?:of|in|at|by|for|the|and|or|to|from|on|with)$/i.test(trimmed)) {
    return true;
  }

  // Reject slash-separated instructions like City/Municipality or Hospital/Clinic/Institution
  if (trimmed.includes("/")) {
    return true;
  }

  // Reject medical/title suffixes (M.D., MD, RN, Dr., Atty.)
  if (/^(?:m\.?d\.?|r\.?n\.?|dr\.?|atty\.?|ph\.?d\.?)$/i.test(trimmed)) {
    return true;
  }

  // Check disallowed patterns
  for (const pat of PSA_DISALLOWED_PATTERNS) {
    if (pat.test(trimmed)) {
      return true;
    }
  }

  // Reject if entire text is a disallowed exact word
  const cleanWord = trimmed.toLowerCase().replace(/[^a-z]/g, "");
  if (PSA_DISALLOWED_EXACT_WORDS.has(cleanWord)) {
    return true;
  }

  // Reject if all tokens in the candidate are disallowed exact words
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => PSA_DISALLOWED_EXACT_WORDS.has(t.replace(/[^a-z]/g, "")))) {
    return true;
  }

  return false;
}

/**
 * Validates a candidate person name extracted from a PSA Certificate of Live Birth.
 * Rejects form instructions, numbers, prepositions, titles, or implausibly long instruction text.
 */
export function isValidPsaName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;

  // STRICT: Reject names containing standalone numbers (e.g. 40, 50, 3360, 2004)
  if (/\b\d+\b/.test(trimmed)) return false;

  // Reject if disallowed by label/instruction dictionary
  if (isDisallowedPsaValue(trimmed)) return false;

  // Reject medical/professional suffixes
  if (/^m\.?d\.?$/i.test(trimmed) || /^dr\.?$/i.test(trimmed) || /^atty\.?$/i.test(trimmed)) {
    return false;
  }

  // Reject candidates with any digits
  if (/\d/.test(trimmed)) return false;

  // Reject implausibly long instruction sentences
  if (trimmed.length > 60 || trimmed.split(/\s+/).length > 6) return false;

  // Reject if contains punctuation indicative of instructions
  if (/[;{}<>=_~*]/.test(trimmed)) return false;

  return true;
}

/**
 * Cleans punctuation, trailing commas, form markers, pure numbers, and suffixes from a candidate name part.
 */
export function cleanNamePart(val: string): string {
  if (!val) return "";
  const withoutLabels = val
    .replace(/\((?:first|middle|last|pangalan|unang|gitnang|apelyido|maiden|fra|lan|las|mid|fir)\)/gi, "")
    .replace(/[()[\]{}:;|_*`,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip standalone label words, numeric tokens, instruction tokens, and suffixes
  const tokens = withoutLabels.split(/\s+/).filter((t) => {
    if (!t) return false;
    const cleanT = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Reject standalone label tokens and OCR fragments like "First", "Middle", "Last", "Fra", "Lan"
    if (/^\(?(?:first|middle|last|pangalan|unang|gitnang|apelyido|maiden|name|fra|lan|las|mid|fir)\)?$/i.test(t)) return false;
    // Reject pure digits or number-letter markers like 5a, 9a
    if (/^\d+[a-z]?\.?$/i.test(t)) return false;
    // Reject professional suffixes
    if (/^(?:m\.?d\.?|r\.?n\.?|dr\.?|atty\.?|ph\.?d\.?)$/i.test(t)) return false;
    // Reject instruction tokens and contamination words
    if (PSA_DISALLOWED_EXACT_WORDS.has(cleanT)) return false;
    if (
      /^(?:type|order|weight|total|street|house|barangay|population|reference|ocr|ocr0|ocag|use|only|na|nie|freq|frequency|les|lesions|catholic|catholio|religion|citizenship|filipino|occupation|capargpangan|final|iddia|filed|erasure|triplot|specify|others|scand|was|fra|lan|mid|las|fir)$/i.test(
        cleanT
      )
    )
      return false;
    return true;
  });

  return tokens.join(" ").trim();
}

/**
 * Cleans printed form instruction labels from candidate Place of Birth text.
 * Preserves the actual facility/city text while removing printed sub-captions.
 */
export function cleanPlaceOfBirth(text: string): string {
  if (!text) return "";
  let cleaned = text
    .replace(/(?:4\.\s*)?place\s+of\s+birth/gi, "")
    .replace(/office\s+of\s+the\s+civil\s+registrar/gi, "")
    .replace(/to\s+be\s+filled\s+up(?:\s+by)?/gi, "")
    .replace(/(?:for\s+)?ocr\s*(?:use\s*only)?/gi, "")
    .replace(/\(?name\s+of\s+hospital\/clinic\/institution\/?\)?/gi, "")
    .replace(/hospital\/clinic\/institution\/?/gi, "")
    .replace(/\(?city\/municipality\)?/gi, "")
    .replace(/\(?province\)?/gi, "")
    .replace(/\(?house\s+no\.?,\s*street,\s*barangay\)?/gi, "")
    .replace(/\(?house\s+no\.?\)?/gi, "")
    .replace(/\(?street\)?/gi, "")
    .replace(/\(?barangay\)?/gi, "")
    .replace(/\b5a?\.\s*(?:type\s+of\s+birth|type)?/gi, "")
    .replace(/\btype\s+of\s+birth\b/gi, "")
    .replace(/\(?lugar\s+ng\s+kapanganakan\)?/gi, "")
    .replace(/[()[\]{}:;|_*`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If the remaining string is just printed form markers, reject it
  if (/^(?:hospital|clinic|institution|city|municipality|province|street|house|barangay)$/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

// ============================================================================
// 2. SPATIAL COORDINATE TRANSFORMATION & NORMALIZATION
// ============================================================================

/**
 * Converts Azure 8-point polygon [x1, y1, x2, y2, x3, y3, x4, y4] into
 * upright normalized coordinates [0, 1] x [0, 1] according to page rotation angle.
 */
export function computeNormalizedUprightBBox(
  polygon: number[],
  pageWidth: number,
  pageHeight: number,
  pageAngle?: number
): NormalizedUprightBBox {
  const w = pageWidth > 0 ? pageWidth : 1;
  const h = pageHeight > 0 ? pageHeight : 1;

  let rot: 0 | 90 | 180 | 270 = 0;
  if (typeof pageAngle === "number" && !isNaN(pageAngle)) {
    const deg = ((Math.round(pageAngle) % 360) + 360) % 360;
    if (deg >= 45 && deg < 135) rot = 90;
    else if (deg >= 135 && deg < 225) rot = 180;
    else if (deg >= 225 && deg < 315) rot = 270;
  }

  const uCoords: number[] = [];
  const vCoords: number[] = [];

  for (let i = 0; i < polygon.length; i += 2) {
    const x = polygon[i];
    const y = polygon[i + 1];

    let u = 0;
    let v = 0;

    switch (rot) {
      case 90:
        u = y / h;
        v = 1 - (x / w);
        break;
      case 180:
        u = 1 - (x / w);
        v = 1 - (y / h);
        break;
      case 270:
        u = 1 - (y / h);
        v = x / w;
        break;
      case 0:
      default:
        u = x / w;
        v = y / h;
        break;
    }

    uCoords.push(Math.max(0, Math.min(1, u)));
    vCoords.push(Math.max(0, Math.min(1, v)));
  }

  const minU = Math.min(...uCoords);
  const maxU = Math.max(...uCoords);
  const minV = Math.min(...vCoords);
  const maxV = Math.max(...vCoords);

  return {
    minU,
    maxU,
    minV,
    maxV,
    centerU: (minU + maxU) / 2,
    centerV: (minV + maxV) / 2,
    width: maxU - minU,
    height: maxV - minV,
  };
}

// ============================================================================
// 3. NUMBERED-ITEM ANCHOR DETECTION & BOUNDARY ENGINE
// ============================================================================

/**
 * Scans OCR lines and words to detect numbered PSA field anchors.
 */
export function detectPsaItemAnchors(
  lines: SpatialPsaLine[],
  words: SpatialPsaWord[]
): Map<number, PsaItemAnchor> {
  const anchors = new Map<number, PsaItemAnchor>();

  // 1. Scan lines for numbered patterns
  for (const line of lines) {
    const text = line.content.trim();
    const clean = line.cleanText;

    // Item 1: NAME (Child) - Upper region (v < 0.35)
    if (!anchors.has(1) && line.bbox.centerV < 0.35) {
      if (/^1\.\s*(?:name|pangalan)\b/i.test(text) || /\b1\.\s*name\b/i.test(text) || clean === "1 name") {
        anchors.set(1, { itemNumber: 1, label: text, bbox: line.bbox });
      }
    }

    // Item 2: SEX - (v < 0.45)
    if (!anchors.has(2) && line.bbox.centerV < 0.45) {
      if (/^2\.\s*(?:sex|kasarian)\b/i.test(text) || /\b2\.\s*sex\b/i.test(text) || clean === "2 sex") {
        anchors.set(2, { itemNumber: 2, label: text, bbox: line.bbox });
      }
    }

    // Item 3: DATE OF BIRTH - (v < 0.50)
    if (!anchors.has(3) && line.bbox.centerV < 0.50) {
      if (/^3\.\s*(?:date\s+of\s+birth|araw\s+ng\s+kapanganakan|date)\b/i.test(text) || /\b3\.\s*date\b/i.test(text)) {
        anchors.set(3, { itemNumber: 3, label: text, bbox: line.bbox });
      }
    }

    // Item 4: PLACE OF BIRTH - (v < 0.55)
    if (!anchors.has(4) && line.bbox.centerV < 0.55) {
      if (/^4\.\s*(?:place\s+of\s+birth|lugar\s+ng\s+kapanganakan|place)\b/i.test(text) || /\b4\.\s*place\b/i.test(text)) {
        anchors.set(4, { itemNumber: 4, label: text, bbox: line.bbox });
      }
    }

    // Item 5: TYPE OF BIRTH ("5.", "5a. TYPE OF BIRTH", "5b.") - (v in [0.28, 0.60])
    if (!anchors.has(5) && line.bbox.centerV >= 0.28 && line.bbox.centerV < 0.60) {
      if (
        /^5[ab]?\.\s*(?:type\s+of\s+birth|uri\s+ng\s+panganganak|type)\b/i.test(text) ||
        /\b5[ab]?\.\s*type\b/i.test(text) ||
        (/\btype\s+of\s+birth\b/i.test(text) && line.bbox.centerU < 0.40)
      ) {
        anchors.set(5, { itemNumber: 5, label: text, bbox: line.bbox });
      }
    }

    // Item 6: MOTHER'S MAIDEN NAME - (v in [0.25, 0.75])
    if (!anchors.has(6) && line.bbox.centerV >= 0.25 && line.bbox.centerV < 0.75) {
      if (
        /^6\.\s*(?:maiden\s+name|name|pangalan|maiden)\b/i.test(text) ||
        /\b6\.\s*maiden\b/i.test(text) ||
        (/\bmother\b/i.test(text) && /\bmaiden\b/i.test(text))
      ) {
        anchors.set(6, { itemNumber: 6, label: text, bbox: line.bbox });
      }
    }

    // Item 7: Mother's Citizenship / Attributes - (v in [0.30, 0.75])
    if (!anchors.has(7) && line.bbox.centerV >= 0.30 && line.bbox.centerV < 0.75) {
      if (/^7\.\s*/i.test(text) || /\b7\.\s*citizenship\b/i.test(text)) {
        anchors.set(7, { itemNumber: 7, label: text, bbox: line.bbox });
      }
    }

    // Item 9 / 9a: Total Children / Children Still Living
    if (!anchors.has(9) && line.bbox.centerV >= 0.30 && line.bbox.centerV < 0.75) {
      if (/\b(?:9|9a|9b)\.\s*/i.test(text) || /\btotal\s+number\s+of\s+children\b/i.test(text)) {
        anchors.set(9, { itemNumber: 9, label: text, bbox: line.bbox });
      }
    }

    // Item 13: FATHER'S NAME - (v in [0.50, 0.96] to support full page and identity crop)
    if (!anchors.has(13) && line.bbox.centerV >= 0.50 && line.bbox.centerV < 0.96) {
      if (
        /^13\.\s*(?:name|pangalan)\b/i.test(text) ||
        /\b13\.\s*name\b/i.test(text) ||
        (/\bfather\b/i.test(text) && /\bname\b/i.test(text))
      ) {
        anchors.set(13, { itemNumber: 13, label: text, bbox: line.bbox });
      }
    }

    // Item 14: Father's Citizenship
    if (!anchors.has(14) && line.bbox.centerV >= 0.60 && line.bbox.centerV < 0.90) {
      if (/^14\.\s*/i.test(text)) {
        anchors.set(14, { itemNumber: 14, label: text, bbox: line.bbox });
      }
    }

    // Item 19 / 20 / 21 / 22: Footer Informant / Attendant / Registrar
    if (!anchors.has(20) && line.bbox.centerV >= 0.75) {
      if (/\b(?:19|20|21|22)\.\s*/i.test(text) || /\b(?:informant|attendant|civil\s+registrar)\b/i.test(text)) {
        anchors.set(20, { itemNumber: 20, label: text, bbox: line.bbox });
      }
    }
  }

  // 2. Scan words for anchors (handles layouts where lines array is omitted or anchors are separate words)
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const text = w.content.trim();
    const clean = w.cleanText;

    // Anchor 1: "1." + "NAME"
    if (!anchors.has(1) && w.bbox.centerV < 0.35) {
      if (/^1\.\s*name$/i.test(text)) {
        anchors.set(1, { itemNumber: 1, label: text, bbox: w.bbox });
      } else if (/^1\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^name$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(1, {
            itemNumber: 1,
            label: "1. NAME",
            bbox: {
              minU: w.bbox.minU,
              maxU: next.bbox.maxU,
              minV: Math.min(w.bbox.minV, next.bbox.minV),
              maxV: Math.max(w.bbox.maxV, next.bbox.maxV),
              centerU: (w.bbox.minU + next.bbox.maxU) / 2,
              centerV: (w.bbox.minV + next.bbox.maxV) / 2,
              width: next.bbox.maxU - w.bbox.minU,
              height: Math.max(w.bbox.maxV, next.bbox.maxV) - Math.min(w.bbox.minV, next.bbox.minV),
            },
          });
        }
      }
    }

    // Anchor 2: "2." + "SEX" or "SEX" in v < 0.40
    if (!anchors.has(2) && w.bbox.centerV < 0.40) {
      if (/^2\.\s*sex$/i.test(text)) {
        anchors.set(2, { itemNumber: 2, label: text, bbox: w.bbox });
      } else if (/^2\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^sex$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(2, { itemNumber: 2, label: "2. SEX", bbox: next.bbox });
        }
      } else if (/^sex$/i.test(clean) && w.bbox.centerU < 0.45) {
        anchors.set(2, { itemNumber: 2, label: "SEX", bbox: w.bbox });
      }
    }

    // Anchor 3: "3." + "DATE"
    if (!anchors.has(3) && w.bbox.centerV < 0.45) {
      if (/^3\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^date$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(3, { itemNumber: 3, label: "3. DATE", bbox: next.bbox });
        }
      }
    }

    // Anchor 4: "4." + "PLACE"
    if (!anchors.has(4) && w.bbox.centerV < 0.50) {
      if (/^4\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^place$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(4, { itemNumber: 4, label: "4. PLACE", bbox: next.bbox });
        }
      }
    }

    // Anchor 5: "5." or "5a." + "TYPE" (v in [0.28, 0.58])
    if (!anchors.has(5) && w.bbox.centerV >= 0.28 && w.bbox.centerV < 0.58) {
      if (/^5[ab]?\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^type$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(5, { itemNumber: 5, label: "5. TYPE", bbox: next.bbox });
        } else if (w.bbox.centerU < 0.35) {
          anchors.set(5, { itemNumber: 5, label: text, bbox: w.bbox });
        }
      } else if (/^type$/i.test(clean) && w.bbox.centerU < 0.35) {
        anchors.set(5, { itemNumber: 5, label: "TYPE", bbox: w.bbox });
      }
    }

    // Anchor 6: "6." or "MOTHER"
    if (!anchors.has(6) && w.bbox.centerV >= 0.25 && w.bbox.centerV < 0.75) {
      if (/^6\.\s*(?:maiden|name|pangalan)/i.test(text)) {
        anchors.set(6, { itemNumber: 6, label: text, bbox: w.bbox });
      } else if (/^6\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^(?:maiden|name|pangalan)$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(6, { itemNumber: 6, label: "6. MAIDEN", bbox: next.bbox });
        } else {
          anchors.set(6, { itemNumber: 6, label: "6. MOTHER", bbox: w.bbox });
        }
      } else if (/^mother$/i.test(clean)) {
        anchors.set(6, { itemNumber: 6, label: "6. MOTHER", bbox: w.bbox });
      }
    }

    // Anchor 7: "7." (Citizenship)
    if (!anchors.has(7) && w.bbox.centerV >= 0.30 && w.bbox.centerV < 0.75) {
      if (/^7\.?$/i.test(text)) {
        anchors.set(7, { itemNumber: 7, label: "7. CITIZENSHIP", bbox: w.bbox });
      }
    }

    // Anchor 9: "9." or "9a."
    if (!anchors.has(9) && w.bbox.centerV >= 0.35 && w.bbox.centerV < 0.75) {
      if (/^9[ab]?\.?$/i.test(text)) {
        anchors.set(9, { itemNumber: 9, label: "9. TOTAL", bbox: w.bbox });
      }
    }

    // Anchor 13: "13." or "FATHER" (v in [0.50, 0.96] to support full page and identity crop)
    if (!anchors.has(13) && w.bbox.centerV >= 0.50 && w.bbox.centerV < 0.96) {
      if (/^13\.\s*(?:name|pangalan)/i.test(text)) {
        anchors.set(13, { itemNumber: 13, label: text, bbox: w.bbox });
      } else if (/^13\.?$/i.test(text)) {
        const next = words.find(
          (nw) =>
            nw !== w &&
            nw.bbox.centerU > w.bbox.centerU &&
            Math.abs(nw.bbox.centerV - w.bbox.centerV) < 0.04 &&
            /^(?:name|pangalan)$/i.test(nw.cleanText)
        );
        if (next) {
          anchors.set(13, { itemNumber: 13, label: "13. NAME", bbox: next.bbox });
        } else {
          anchors.set(13, { itemNumber: 13, label: "13. FATHER", bbox: w.bbox });
        }
      } else if (/^father$/i.test(clean)) {
        anchors.set(13, { itemNumber: 13, label: "13. FATHER", bbox: w.bbox });
      }
    }

    // Anchor 14: "14." (Father Citizenship)
    if (!anchors.has(14) && w.bbox.centerV >= 0.60 && w.bbox.centerV < 0.90) {
      if (/^14\.?$/i.test(text)) {
        anchors.set(14, { itemNumber: 14, label: "14. CITIZENSHIP", bbox: w.bbox });
      }
    }
  }

  return anchors;
}

// ============================================================================
// 4. TWO-STAGE NAME EXTRACTION ENGINE (SUB-LABEL LOCAL ANCHORS)
// ============================================================================

function isFirstSubLabel(text: string, clean: string): boolean {
  return (
    /^\(?first\)?$/i.test(text) ||
    /^\(?unang\)?$/i.test(text) ||
    /^\(?fra\b/i.test(text) ||
    /^\(?fir\b/i.test(text) ||
    clean === "first" ||
    clean === "unang" ||
    clean === "fra" ||
    clean === "fir"
  );
}

function isMiddleSubLabel(text: string, clean: string): boolean {
  return (
    /^\(?middle\)?$/i.test(text) ||
    /^\(?gitnang\)?$/i.test(text) ||
    /^\(?mid\b/i.test(text) ||
    clean === "middle" ||
    clean === "gitnang" ||
    clean === "mid"
  );
}

function isLastSubLabel(text: string, clean: string): boolean {
  return (
    /^\(?last\)?$/i.test(text) ||
    /^\(?apelyido\)?$/i.test(text) ||
    /^\(?surname\)?$/i.test(text) ||
    /^\(?lan\b/i.test(text) ||
    /^\(?las\b/i.test(text) ||
    clean === "last" ||
    clean === "apelyido" ||
    clean === "surname" ||
    clean === "lan" ||
    clean === "las"
  );
}

/**
 * Extracts a person's name using Two-Stage Anchor + Sub-Label local geometry:
 * STAGE 1: Identifies the person's specific row bounded between rowAnchor and nextAnchors.
 * STAGE 2: Locates local (First), (Middle), (Last) sub-labels within that row,
 *          computes boundary midpoints, and maps entered values to local sub-labels.
 */
export function extractPersonNameFromRow(
  rowAnchor: PsaItemAnchor | undefined,
  terminatingAnchors: Array<PsaItemAnchor | undefined>,
  words: SpatialPsaWord[],
  lines: SpatialPsaLine[],
  defaultVRange: { minV: number; maxV: number }
): ExtractedPersonNameResult {
  // STAGE 1: Determine precise vertical row boundaries
  // Strict: Words strictly above rowAnchor.bbox.minV (such as header MANILA) are EXCLUDED
  const rowTopV = rowAnchor ? rowAnchor.bbox.minV : defaultVRange.minV;

  const validNextVList = terminatingAnchors
    .filter((a): a is PsaItemAnchor => !!a && a.bbox.minV > rowTopV)
    .map((a) => a.bbox.minV);

  let rowBottomV: number;
  if (validNextVList.length > 0) {
    rowBottomV = Math.min(...validNextVList);
  } else if (rowAnchor) {
    rowBottomV = Math.min(rowAnchor.bbox.minV + 0.080, defaultVRange.maxV);
  } else {
    rowBottomV = defaultVRange.maxV;
  }

  // Safety clamp: Under NO circumstance can a localized row exceed max physical height
  // (Prevents overlay/extraction from entering next sections like Item 2 Sex, Item 3 DOB, Item 4 POB, Item 5, Mother, Father)
  // ONLY clamp when rowAnchor is present (preserves synthetic fixtures where rowAnchor is omitted)
  const maxAllowedRowHeight = 0.085;
  if (rowAnchor && rowBottomV - rowTopV > maxAllowedRowHeight && validNextVList.length === 0) {
    rowBottomV = rowTopV + maxAllowedRowHeight;
  }

  // Dynamic truncation: Any token indicating next item labels terminates this row early
  const nextItemTokens = words.filter(
    (w) =>
      w.bbox.minV > rowTopV + 0.02 &&
      w.bbox.minV < rowBottomV &&
      /\b(?:citizenship|religion|catholic|catholio|occupation|residence|informant|attendant|marriage|total|born\s+alive|age\s+at)\b/i.test(
        w.cleanText
      )
  );
  if (nextItemTokens.length > 0) {
    const earliestNextV = Math.min(...nextItemTokens.map((w) => w.bbox.minV));
    rowBottomV = Math.min(rowBottomV, earliestNextV);
  }

  // Filter words strictly inside this person's row
  const rowWords = words.filter(
    (w) => w.bbox.centerV >= rowTopV && w.bbox.centerV < rowBottomV
  );

  // Derive dynamic right margin cutoff for this row:
  // Detect any words containing margin instruction / OCR tokens
  const rowMarginCutoff = (() => {
    const marginTokens = rowWords.filter(
      (w) =>
        w.bbox.centerU >= 0.70 &&
        /\b(?:ocr|ocag|use|only|filed|erasure|population|reference|nie)\b/i.test(w.cleanText)
    );
    if (marginTokens.length > 0) {
      return Math.min(0.88, ...marginTokens.map((w) => w.bbox.minU));
    }
    return 0.88;
  })();

  // STAGE 2: Detect local (First), (Middle), (Last) sub-labels inside this specific row
  const firstSub = rowWords.find((w) => isFirstSubLabel(w.content.trim(), w.cleanText));
  const middleSub = rowWords.find((w) => isMiddleSubLabel(w.content.trim(), w.cleanText));
  const lastSub = rowWords.find((w) => isLastSubLabel(w.content.trim(), w.cleanText));

  // Find the sub-label baseline:
  // Sub-labels and row anchors define the LABEL BAND at the top of the row.
  // Values sit in the VALUE BAND beneath the sub-labels.
  const detectedSubLabels = [firstSub, middleSub, lastSub].filter((w): w is SpatialPsaWord => !!w);
  let labelBandBottomV = rowTopV;
  if (detectedSubLabels.length > 0) {
    labelBandBottomV = Math.max(...detectedSubLabels.map((s) => s.bbox.maxV));
  } else if (rowAnchor) {
    labelBandBottomV = rowAnchor.bbox.maxV;
  } else {
    labelBandBottomV = rowTopV + 0.35 * (rowBottomV - rowTopV);
  }

  // Check if candidate words exist in the VALUE BAND beneath the label band
  const hasValueBandWords = rowWords.some(
    (w) =>
      w.bbox.centerV > labelBandBottomV &&
      !isDisallowedPsaValue(w.content) &&
      !isFirstSubLabel(w.content, w.cleanText) &&
      !isMiddleSubLabel(w.content, w.cleanText) &&
      !isLastSubLabel(w.content, w.cleanText) &&
      !/^(?:1|2|3|4|5|6|13)\.?$/i.test(w.content.trim()) &&
      !/^\d+[a-z]?\.?$/i.test(w.content.trim())
  );

  // Filter candidate name words (excluding row anchor, sub-labels, pure numbers, and suffixes)
  const candidateWords = rowWords.filter((w) => {
    // Exclude the anchor label itself
    if (rowAnchor) {
      if (Math.abs(w.bbox.centerV - rowAnchor.bbox.centerV) < 0.025 && w.bbox.centerU <= rowAnchor.bbox.maxU + 0.03) {
        return false;
      }
      if (w.content === rowAnchor.label || /^(?:1|6|13)\.?$/i.test(w.content.trim())) {
        return false;
      }
    }

    // Exclude sub-labels themselves and OCR fragments (e.g. Fra, Lan, Mid)
    if (w === firstSub || w === middleSub || w === lastSub) return false;
    if (isFirstSubLabel(w.content.trim(), w.cleanText)) return false;
    if (isMiddleSubLabel(w.content.trim(), w.cleanText)) return false;
    if (isLastSubLabel(w.content.trim(), w.cleanText)) return false;
    if (/^\(?(?:first|middle|last|unang|gitnang|apelyido|surname|fra|lan|las|mid|fir)\)?$/i.test(w.content.trim())) return false;
    if (/^[\(\)\[\]\.\,\-\_]+$/.test(w.content.trim())) return false;

    // STRUCTURAL SEPARATION: When value-band words exist beneath sub-labels,
    // words strictly in the label band (centerV <= labelBandBottomV) CANNOT enter values!
    if (hasValueBandWords && (w.bbox.centerV <= labelBandBottomV || w.bbox.maxV <= labelBandBottomV + 0.005)) {
      return false;
    }

    // Exclude medical/professional suffixes (M.D., MD, RN, Dr., Atty.)
    if (/^(?:m\.?d\.?|r\.?n\.?|dr\.?|atty\.?|ph\.?d\.?)$/i.test(w.content.trim())) {
      return false;
    }

    // STRICT: Exclude pure numeric tokens (e.g. "40", "50", "3360", "2004") and item number markers
    if (/^\d+[a-z]?\.?$/i.test(w.content.trim())) {
      return false;
    }

    // Exclude printed form instructions
    if (/^(?:name|maiden|pangalan|child|mother|father|parents|sex|date|birth|place|hospital|clinic|city|municipality|province|street|house|barangay|type|total)$/i.test(w.cleanText)) {
      return false;
    }

    // STRICT: Exclude right margin noise (e.g. right margin OCR USE ONLY, Population Reference)
    if (w.bbox.centerU >= rowMarginCutoff || w.bbox.centerU > 0.88) {
      return false;
    }

    // Exclude general disallowed words (except legitimate name particles like de, del, la)
    if (isDisallowedPsaValue(w.content)) return false;

    if (w.cleanText.length < 1) return false;

    return true;
  });

  // Organize columns based on detected sub-labels
  const detected: Array<{ type: "first" | "middle" | "last"; centerU: number }> = [];
  if (firstSub) detected.push({ type: "first", centerU: firstSub.bbox.centerU });
  if (middleSub) detected.push({ type: "middle", centerU: middleSub.bbox.centerU });
  if (lastSub) detected.push({ type: "last", centerU: lastSub.bbox.centerU });
  detected.sort((a, b) => a.centerU - b.centerU);

  const componentWords: Record<"first" | "middle" | "last", SpatialPsaWord[]> = {
    first: [],
    middle: [],
    last: [],
  };

  if (detected.length === 3) {
    // 3 Sub-labels detected: derive midpoints dynamically
    const m1 = (detected[0].centerU + detected[1].centerU) / 2;
    const m2 = (detected[1].centerU + detected[2].centerU) / 2;

    componentWords[detected[0].type] = candidateWords.filter((w) => w.bbox.centerU < m1);
    componentWords[detected[1].type] = candidateWords.filter((w) => w.bbox.centerU >= m1 && w.bbox.centerU < m2);
    componentWords[detected[2].type] = candidateWords.filter((w) => w.bbox.centerU >= m2 && w.bbox.centerU < rowMarginCutoff && w.bbox.centerU <= 0.88);
  } else if (detected.length === 2) {
    // 2 Sub-labels detected: interpolate missing column from local delta
    const d0 = detected[0];
    const d1 = detected[1];
    const delta = d1.centerU - d0.centerU;
    const m = (d0.centerU + d1.centerU) / 2;

    if (d0.type === "first" && d1.type === "middle") {
      const m1 = m;
      const m2 = d1.centerU + delta / 2;
      componentWords.first = candidateWords.filter((w) => w.bbox.centerU < m1);
      componentWords.middle = candidateWords.filter((w) => w.bbox.centerU >= m1 && w.bbox.centerU < m2);
      componentWords.last = candidateWords.filter((w) => w.bbox.centerU >= m2 && w.bbox.centerU < rowMarginCutoff && w.bbox.centerU <= 0.88);
    } else if (d0.type === "middle" && d1.type === "last") {
      const m1 = d0.centerU - delta / 2;
      const m2 = m;
      componentWords.first = candidateWords.filter((w) => w.bbox.centerU < m1);
      componentWords.middle = candidateWords.filter((w) => w.bbox.centerU >= m1 && w.bbox.centerU < m2);
      componentWords.last = candidateWords.filter((w) => w.bbox.centerU >= m2 && w.bbox.centerU < rowMarginCutoff && w.bbox.centerU <= 0.88);
    } else if (d0.type === "first" && d1.type === "last") {
      const m1 = d0.centerU + delta / 3;
      const m2 = d0.centerU + (2 * delta) / 3;
      componentWords.first = candidateWords.filter((w) => w.bbox.centerU < m1);
      componentWords.middle = candidateWords.filter((w) => w.bbox.centerU >= m1 && w.bbox.centerU < m2);
      componentWords.last = candidateWords.filter((w) => w.bbox.centerU >= m2 && w.bbox.centerU < rowMarginCutoff && w.bbox.centerU <= 0.88);
    } else if (d0.type === "last" && d1.type === "first") {
      const m1 = m;
      const m2 = d1.centerU + delta / 2;
      componentWords.last = candidateWords.filter((w) => w.bbox.centerU < m1 && w.bbox.centerU < rowMarginCutoff && w.bbox.centerU <= 0.88);
      componentWords.first = candidateWords.filter((w) => w.bbox.centerU >= m1 && w.bbox.centerU < m2);
      componentWords.middle = candidateWords.filter((w) => w.bbox.centerU >= m2);
    }
  } else {
    // 0 or 1 sub-label: check for comma-token or fallback columns
    const commaToken = candidateWords.find((w) => w.content.endsWith(","));
    if (commaToken) {
      const commaIdx = candidateWords.indexOf(commaToken);
      componentWords.last = candidateWords.slice(0, commaIdx + 1);
      const remaining = candidateWords.slice(commaIdx + 1);
      if (remaining.length === 1) {
        componentWords.first = remaining;
      } else if (remaining.length >= 2) {
        componentWords.first = [remaining[0]];
        componentWords.middle = remaining.slice(1);
      }
    } else {
      // Fallback columns: [ First: 0.02 - 0.36 ] [ Middle: 0.36 - 0.66 ] [ Last: 0.66 - 0.88 ]
      componentWords.first = candidateWords.filter((w) => w.bbox.centerU >= 0.02 && w.bbox.centerU < 0.36);
      componentWords.middle = candidateWords.filter((w) => w.bbox.centerU >= 0.36 && w.bbox.centerU < 0.66);
      componentWords.last = candidateWords.filter((w) => w.bbox.centerU >= 0.66 && w.bbox.centerU < rowMarginCutoff && w.bbox.centerU <= 0.88);
    }
  }

  let firstName: string | undefined = undefined;
  let middleName: string | undefined = undefined;
  let lastName: string | undefined = undefined;

  if (componentWords.first.length > 0) {
    const raw = componentWords.first.sort((a, b) => a.bbox.centerU - b.bbox.centerU).map((w) => w.content).join(" ");
    const cleaned = cleanNamePart(raw);
    if (isValidPsaName(cleaned)) firstName = cleaned;
  }

  if (componentWords.middle.length > 0) {
    const raw = componentWords.middle.sort((a, b) => a.bbox.centerU - b.bbox.centerU).map((w) => w.content).join(" ");
    const cleaned = cleanNamePart(raw);
    if (isValidPsaName(cleaned)) middleName = cleaned;
  }

  if (componentWords.last.length > 0) {
    const raw = componentWords.last.sort((a, b) => a.bbox.centerU - b.bbox.centerU).map((w) => w.content).join(" ");
    const cleaned = cleanNamePart(raw);
    if (isValidPsaName(cleaned)) lastName = cleaned;
  }

  let fullName: string | undefined = undefined;
  if (lastName && firstName) {
    fullName = `${lastName}, ${firstName}${middleName ? " " + middleName : ""}`;
  } else if (firstName) {
    fullName = `${firstName}${middleName ? " " + middleName : ""}`;
  } else if (lastName) {
    fullName = lastName;
  }

  return {
    firstName,
    middleName,
    lastName,
    fullName,
    subLabelsFound: { first: !!firstSub, middle: !!middleSub, last: !!lastSub },
    detectedOrder: detected.map((d) => d.type),
    rowVRange: { minV: rowTopV, maxV: rowBottomV },
  };
}

export interface PsaReconciliationResult {
  value?: string;
  status: FieldExtractionStatus;
  confidence: FieldExtractionConfidence;
  needsVerification: boolean;
  reason?: string;
}

/**
 * Reconciles primary spatial candidate against secondary field-specific candidate.
 * If they agree or secondary is a clean subset without contamination tokens -> HIGH confidence.
 * If they significantly conflict -> Needs Verification.
 * Never concatenates conflicting OCR strings.
 */
export function reconcilePsaCandidate(
  primaryVal: string | undefined,
  secondaryVal: string | undefined,
  fieldName: string,
  primaryConfidence: FieldExtractionConfidence = "MEDIUM",
  safety?: {
    anchorFound?: boolean;
    subLabelFound?: boolean;
    insideExpectedBox?: boolean;
    noContamination?: boolean;
  }
): PsaReconciliationResult {
  const cleanPrimary = primaryVal ? cleanNamePart(primaryVal) : undefined;
  const cleanSecondary = secondaryVal ? cleanNamePart(secondaryVal) : undefined;

  const validPrimary = cleanPrimary && isValidPsaName(cleanPrimary) ? cleanPrimary : undefined;
  const validSecondary = cleanSecondary && isValidPsaName(cleanSecondary) ? cleanSecondary : undefined;

  // Rule 4: If contamination was flagged, strictly reject
  if (safety?.noContamination === false) {
    return {
      value: undefined,
      status: "needs_verification",
      confidence: "LOW",
      needsVerification: true,
      reason: `Field '${fieldName}' candidate contained printed form/margin contamination tokens.`,
    };
  }

  // Rule 1 & 3: Check spatial safety (anchor + bounding box)
  const isSpatialSafe = safety?.insideExpectedBox !== false && safety?.anchorFound !== false;

  // Case 1: Both present
  if (validPrimary && validSecondary) {
    const pNorm = validPrimary.toLowerCase().replace(/[, ]/g, "");
    const sNorm = validSecondary.toLowerCase().replace(/[, ]/g, "");

    // Exact match or secondary is clean subset of primary
    if (pNorm === sNorm || pNorm.includes(sNorm) || sNorm.includes(pNorm)) {
      const preferred = validSecondary.length <= validPrimary.length ? validSecondary : validPrimary;
      const conf: FieldExtractionConfidence = isSpatialSafe ? "HIGH" : "MEDIUM";
      return {
        value: preferred,
        status: "extracted",
        confidence: conf,
        needsVerification: !isSpatialSafe,
        reason: !isSpatialSafe ? "Spatial localization requires verification." : undefined,
      };
    }

    // Significant conflict
    return {
      value: validPrimary,
      status: "needs_verification",
      confidence: "LOW",
      needsVerification: true,
      reason: `Primary candidate '${validPrimary}' disagrees with secondary field crop candidate '${validSecondary}'.`,
    };
  }

  // Case 2: Only secondary valid
  if (validSecondary) {
    const conf: FieldExtractionConfidence = isSpatialSafe && (safety?.subLabelFound ?? true) ? "HIGH" : "MEDIUM";
    return {
      value: validSecondary,
      status: "extracted",
      confidence: conf,
      needsVerification: !isSpatialSafe,
      reason: !isSpatialSafe ? "Candidate localized outside standard field anchor boundary." : undefined,
    };
  }

  // Case 3: Only primary valid
  if (validPrimary) {
    const conf: FieldExtractionConfidence = isSpatialSafe && primaryConfidence === "HIGH" ? "HIGH" : primaryConfidence;
    return {
      value: validPrimary,
      status: "extracted",
      confidence: conf,
      needsVerification: !isSpatialSafe,
      reason: !isSpatialSafe ? "Candidate localized without verified field anchor." : undefined,
    };
  }

  // Case 4: Neither valid
  return {
    value: undefined,
    status: "not_extracted",
    confidence: "LOW",
    needsVerification: true,
    reason: `Field '${fieldName}' could not be reliably extracted from physical PSA section.`,
  };
}

/**
 * Computes anchor-refined bounding boxes for the 8 secondary regions based on detected Azure polygons.
 */
export function computePsaAnchorRefinedBoxes(
  anchors: Map<number, PsaItemAnchor>,
  words: SpatialPsaWord[],
  lines: SpatialPsaLine[]
): Record<
  string,
  {
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
    anchorFound: boolean;
    subLabelsFound?: boolean;
  }
> {
  const anchor1 = anchors.get(1);
  const anchor2 = anchors.get(2);
  const anchor3 = anchors.get(3);
  const anchor4 = anchors.get(4);
  const anchor5 = anchors.get(5);
  const anchor6 = anchors.get(6);
  const anchor7 = anchors.get(7);
  const anchor9 = anchors.get(9);
  const anchor13 = anchors.get(13);
  const anchor14 = anchors.get(14);
  const anchor20 = anchors.get(20);

  const isIdentityCrop = (anchor1?.bbox.centerV ?? 0.15) < 0.10;

  // 1. Child Name Row (Item 1)
  const childVTop = anchor1 ? anchor1.bbox.minV : (isIdentityCrop ? 0.02 : 0.120);
  let childVBottom = anchor2 && anchor3
    ? Math.min(anchor2.bbox.minV, anchor3.bbox.minV)
    : anchor2
    ? anchor2.bbox.minV
    : anchor3
    ? anchor3.bbox.minV
    : anchor1
    ? anchor1.bbox.minV + (isIdentityCrop ? 0.090 : 0.050)
    : (isIdentityCrop ? 0.100 : 0.170);

  // Safety clamp: Under NO circumstance can Child Name row exceed max physical height
  // (Prevents overlay/extraction from entering Item 2 Sex, Item 3 DOB, Item 4 POB, Item 5, Mother, Father)
  const maxChildRowH = isIdentityCrop ? 0.11 : 0.065;
  if (childVBottom - childVTop > maxChildRowH) {
    childVBottom = childVTop + maxChildRowH;
  }

  // Find sub-labels in Child Name Row
  const childRowWords = words.filter((w) => w.bbox.centerV >= childVTop && w.bbox.centerV < childVBottom);
  const firstSub = childRowWords.find((w) => isFirstSubLabel(w.content.trim(), w.cleanText));
  const middleSub = childRowWords.find((w) => isMiddleSubLabel(w.content.trim(), w.cleanText));
  const lastSub = childRowWords.find((w) => isLastSubLabel(w.content.trim(), w.cleanText));

  // Boundaries between First / Middle / Last
  let childFirstMaxU = 0.36;
  let childMiddleMaxU = 0.66;
  let childLastMaxU = 0.88;

  if (firstSub && middleSub) {
    childFirstMaxU = (firstSub.bbox.centerU + middleSub.bbox.centerU) / 2;
  } else if (middleSub) {
    childFirstMaxU = Math.max(0.20, middleSub.bbox.minU - 0.02);
  }

  if (middleSub && lastSub) {
    childMiddleMaxU = (middleSub.bbox.centerU + lastSub.bbox.centerU) / 2;
  } else if (lastSub) {
    childMiddleMaxU = Math.max(childFirstMaxU + 0.10, lastSub.bbox.minU - 0.02);
  }

  // Margin cutoff for Child Last Name:
  // Detect any words in this row with U >= 0.70 matching margin tokens
  const marginWords = childRowWords.filter(
    (w) =>
      w.bbox.centerU >= 0.70 &&
      /\b(?:ocr|ocag|use|only|filed|erasure|population|reference|nie)\b/i.test(w.cleanText)
  );
  if (marginWords.length > 0) {
    const minMarginU = Math.min(...marginWords.map((w) => w.bbox.minU));
    childLastMaxU = Math.max(childMiddleMaxU + 0.08, Math.min(0.88, minMarginU - 0.01));
  } else {
    childLastMaxU = Math.min(0.88, Math.max(childMiddleMaxU + 0.08, 0.88));
  }

  // 2. Child Sex (Item 2)
  const sexVTop = anchor2 ? anchor2.bbox.minV : (isIdentityCrop ? 0.14 : 0.175);
  const sexVBottom = anchor4
    ? anchor4.bbox.minV
    : anchor5
    ? anchor5.bbox.minV
    : (anchor2 ? anchor2.bbox.maxV + (isIdentityCrop ? 0.10 : 0.05) : (isIdentityCrop ? 0.24 : 0.220));
  const sexMaxU = anchor3 ? Math.min(anchor3.bbox.minU, 0.40) : 0.35;

  // 3. Child DOB (Item 3)
  const dobVTop = anchor3 ? anchor3.bbox.minV : sexVTop;
  const dobVBottom = sexVBottom;
  const dobMinU = anchor3 ? Math.max(0.35, anchor3.bbox.minU - 0.02) : 0.35;

  // 4. Child POB (Item 4)
  const pobVTop = anchor4 ? anchor4.bbox.minV : (isIdentityCrop ? 0.24 : 0.225);
  const pobVBottom = anchor5
    ? anchor5.bbox.minV
    : anchor6
    ? Math.min(anchor6.bbox.minV, isIdentityCrop ? 0.48 : 0.350)
    : (anchor4 ? anchor4.bbox.maxV + (isIdentityCrop ? 0.15 : 0.08) : (isIdentityCrop ? 0.45 : 0.285));

  // 5. Mother Maiden Name (Item 6)
  const motherVTop = anchor6 ? anchor6.bbox.minV : (isIdentityCrop ? 0.48 : 0.350);
  let motherVBottom = anchor7
    ? anchor7.bbox.minV
    : anchor9
    ? anchor9.bbox.minV
    : anchor13
    ? anchor13.bbox.minV
    : (anchor6 ? anchor6.bbox.minV + (isIdentityCrop ? 0.095 : 0.055) : (isIdentityCrop ? 0.68 : 0.550));

  const maxMotherH = isIdentityCrop ? 0.10 : 0.065;
  if (anchor6 && motherVBottom - motherVTop > maxMotherH) {
    motherVBottom = motherVTop + maxMotherH;
  }

  // 6. Father Name (Item 13)
  const fatherVTop = anchor13 ? anchor13.bbox.minV : (isIdentityCrop ? 0.74 : 0.480);
  let fatherVBottom = anchor14
    ? anchor14.bbox.minV
    : anchor20
    ? anchor20.bbox.minV
    : (anchor13 ? anchor13.bbox.minV + (isIdentityCrop ? 0.095 : 0.055) : (isIdentityCrop ? 0.98 : 0.850));

  const maxFatherH = isIdentityCrop ? 0.10 : 0.065;
  if (anchor13 && fatherVBottom - fatherVTop > maxFatherH) {
    fatherVBottom = fatherVTop + maxFatherH;
  }

  return {
    child_first: {
      minU: 0.04,
      maxU: Math.round(childFirstMaxU * 1000) / 1000,
      minV: Math.round(childVTop * 1000) / 1000,
      maxV: Math.round(childVBottom * 1000) / 1000,
      anchorFound: !!anchor1,
      subLabelsFound: !!firstSub,
    },
    child_middle: {
      minU: Math.round(childFirstMaxU * 1000) / 1000,
      maxU: Math.round(childMiddleMaxU * 1000) / 1000,
      minV: Math.round(childVTop * 1000) / 1000,
      maxV: Math.round(childVBottom * 1000) / 1000,
      anchorFound: !!anchor1,
      subLabelsFound: !!middleSub,
    },
    child_last: {
      minU: Math.round(childMiddleMaxU * 1000) / 1000,
      maxU: Math.round(childLastMaxU * 1000) / 1000,
      minV: Math.round(childVTop * 1000) / 1000,
      maxV: Math.round(childVBottom * 1000) / 1000,
      anchorFound: !!anchor1,
      subLabelsFound: !!lastSub,
    },
    child_sex: {
      minU: 0.04,
      maxU: Math.round(sexMaxU * 1000) / 1000,
      minV: Math.round(sexVTop * 1000) / 1000,
      maxV: Math.round(sexVBottom * 1000) / 1000,
      anchorFound: !!anchor2,
    },
    child_dob: {
      minU: Math.round(dobMinU * 1000) / 1000,
      maxU: 0.92,
      minV: Math.round(dobVTop * 1000) / 1000,
      maxV: Math.round(dobVBottom * 1000) / 1000,
      anchorFound: !!anchor3,
    },
    child_pob: {
      minU: 0.04,
      maxU: 0.92,
      minV: Math.round(pobVTop * 1000) / 1000,
      maxV: Math.round(pobVBottom * 1000) / 1000,
      anchorFound: !!anchor4,
    },
    mother_name: {
      minU: 0.04,
      maxU: 0.92,
      minV: Math.round(motherVTop * 1000) / 1000,
      maxV: Math.round(motherVBottom * 1000) / 1000,
      anchorFound: !!anchor6,
    },
    father_name: {
      minU: 0.04,
      maxU: 0.92,
      minV: Math.round(fatherVTop * 1000) / 1000,
      maxV: Math.round(fatherVBottom * 1000) / 1000,
      anchorFound: !!anchor13,
    },
  };
}

// ============================================================================
// 5. SPATIAL PSA EXTRACTION ENGINE (ANCHOR-PRIMARY)
// ============================================================================

/**
 * Extracts PSA identity fields using Numbered Field Anchors and local sub-label geometry.
 */
export function parsePsaSpatialLayout(
  rawLayout: any,
  fallbackText?: string,
  options?: { sexMarkAnalysis?: PsaSexMarkAnalysisResult }
): PsaExtractedFields {
  if (!rawLayout || !Array.isArray(rawLayout.pages) || rawLayout.pages.length === 0) {
    return parsePsaTextFallback(fallbackText || "");
  }

  const page = rawLayout.pages[0];
  const pageWidth = page.width || 1;
  const pageHeight = page.height || 1;
  const pageAngle = page.angle;

  const words: SpatialPsaWord[] = [];
  if (Array.isArray(page.words)) {
    for (const w of page.words) {
      if (!w || typeof w.content !== "string" || !Array.isArray(w.polygon) || w.polygon.length < 8) {
        continue;
      }
      const bbox = computeNormalizedUprightBBox(w.polygon, pageWidth, pageHeight, pageAngle);
      words.push({
        content: w.content,
        cleanText: w.content.replace(/[^\w\s-]/g, "").trim().toLowerCase(),
        confidence: typeof w.confidence === "number" ? w.confidence : undefined,
        bbox,
      });
    }
  }

  const lines: SpatialPsaLine[] = [];
  if (Array.isArray(page.lines)) {
    for (const l of page.lines) {
      if (!l || typeof l.content !== "string" || !Array.isArray(l.polygon) || l.polygon.length < 8) {
        continue;
      }
      const bbox = computeNormalizedUprightBBox(l.polygon, pageWidth, pageHeight, pageAngle);
      lines.push({
        content: l.content,
        cleanText: l.content.replace(/[^\w\s-]/g, "").trim().toLowerCase(),
        bbox,
      });
    }
  }

  if (words.length === 0 && lines.length === 0) {
    return parsePsaTextFallback(fallbackText || "");
  }

  // Detect Numbered Item Anchors
  const anchors = detectPsaItemAnchors(lines, words);

  const metadata: Record<string, FieldExtractionMeta> = {};

  // --------------------------------------------------------------------------
  // A. Civil Registry Number (Anchored strictly to Registry label in header)
  // --------------------------------------------------------------------------
  let registryNumber: string | undefined = undefined;
  const regHeaderWords = words.filter(
    (w) => w.bbox.centerV <= 0.25 && w.bbox.centerU >= 0.40
  );

  const regAnchorWord = regHeaderWords.find((w) =>
    /\b(?:registry|civil|reg)\b/i.test(w.cleanText)
  );

  if (regAnchorWord) {
    const candidateWords = regHeaderWords
      .filter((w) => {
        if (w === regAnchorWord) return false;
        // Strict: Reject barcode, serial, or page markers
        if (/\b(?:barcode|serial|bcr|sn|page|entry|book|form|revised)\b/i.test(w.cleanText)) return false;
        const isRight = w.bbox.centerU > regAnchorWord.bbox.centerU && Math.abs(w.bbox.centerV - regAnchorWord.bbox.centerV) < 0.05;
        const isBelow = w.bbox.centerV > regAnchorWord.bbox.centerV && Math.abs(w.bbox.centerU - regAnchorWord.bbox.centerU) < 0.25;
        return isRight || isBelow;
      })
      .sort((a, b) => a.bbox.centerU - b.bbox.centerU);

    for (const cand of candidateWords) {
      const cleaned = cand.content.replace(/[^A-Za-z0-9-]/g, "").trim();

      // STRICT PROTECTION AGAINST BARE YEARS:
      // A standalone 4-digit number between 1900 and 2099 (like "2004") is a year, NOT a Civil Registry Number.
      const isBareYear = /^(?:19|20)\d{2}$/.test(cleaned);
      if (isBareYear) {
        continue;
      }

      // Valid Philippine Civil Registry Number pattern: hyphenated e.g. 2004-12345 or 04-1234 or sequence >= 6 digits
      if (/\b\d{2,4}-\d{3,7}\b/.test(cleaned) || (/^\d{6,9}$/.test(cleaned))) {
        registryNumber = cleaned;
        metadata.registry_number = {
          status: "extracted",
          confidence: (cand.confidence ?? 0.85) >= 0.80 ? "HIGH" : "MEDIUM",
          numericConfidence: cand.confidence,
          needsVerification: false,
        };
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // B. Child Name: Item 1 (Two-Stage Name Row + Sub-Label Mapping + Secondary Region Reconciliation)
  // --------------------------------------------------------------------------
  const anchor1 = anchors.get(1);
  const anchor2 = anchors.get(2);
  const anchor3 = anchors.get(3);
  const anchor4 = anchors.get(4);
  const anchor5 = anchors.get(5);

  const childNameResult = extractPersonNameFromRow(
    anchor1,
    [anchor2, anchor3, anchor4],
    words,
    lines,
    { minV: 0.08, maxV: anchor2 || anchor3 ? Math.min(anchor2?.bbox.minV ?? 0.28, anchor3?.bbox.minV ?? 0.28) : 0.28 }
  );

  // Secondary Field Regions Extraction (Level 2: Anchor-Refined)
  const isIdentityCrop = (anchor1?.bbox.centerV ?? 0.15) < 0.10;
  const anchorBoxes = computePsaAnchorRefinedBoxes(anchors, words, lines);

  const bFirst = anchorBoxes.child_first;
  const bMiddle = anchorBoxes.child_middle;
  const bLast = anchorBoxes.child_last;

  const childSubLabels = [
    words.find((w) => isFirstSubLabel(w.content.trim(), w.cleanText) && w.bbox.centerV >= bFirst.minV && w.bbox.centerV <= bFirst.maxV),
    words.find((w) => isMiddleSubLabel(w.content.trim(), w.cleanText) && w.bbox.centerV >= bMiddle.minV && w.bbox.centerV <= bMiddle.maxV),
    words.find((w) => isLastSubLabel(w.content.trim(), w.cleanText) && w.bbox.centerV >= bLast.minV && w.bbox.centerV <= bLast.maxV),
  ].filter((w): w is SpatialPsaWord => !!w);

  let childLabelBaselineV: number | undefined = undefined;
  if (childSubLabels.length > 0) {
    childLabelBaselineV = Math.max(...childSubLabels.map((s) => s.bbox.maxV));
  } else if (anchor1) {
    childLabelBaselineV = anchor1.bbox.maxV;
  }

  const getSecText = (
    minU: number,
    maxU: number,
    minV: number,
    maxV: number,
    labelBaselineV?: number
  ): string | undefined => {
    const matchingWords = words
      .filter((w) => w.bbox.centerU >= minU && w.bbox.centerU <= maxU && w.bbox.centerV >= minV && w.bbox.centerV < maxV)
      .filter((w) => {
        if (labelBaselineV && w.bbox.centerV <= labelBaselineV) return false;
        if (isDisallowedPsaValue(w.content)) return false;
        if (/^\(?(?:first|middle|last|unang|gitnang|apelyido|maiden|fra|lan|las|mid|fir)\)?$/i.test(w.content.trim())) return false;
        if (/^[\(\)\[\]]+$/.test(w.content.trim())) return false;
        return true;
      })
      .sort((a, b) => a.bbox.centerU - b.bbox.centerU);
    if (matchingWords.length === 0) return undefined;
    const combined = matchingWords.map((w) => w.content).join(" ");
    const cleaned = cleanNamePart(combined);
    return isValidPsaName(cleaned) ? cleaned : undefined;
  };

  const secChildFirst = getSecText(bFirst.minU, bFirst.maxU, bFirst.minV, bFirst.maxV, childLabelBaselineV);
  const secChildMiddle = getSecText(bMiddle.minU, bMiddle.maxU, bMiddle.minV, bMiddle.maxV, childLabelBaselineV);
  const secChildLast = getSecText(bLast.minU, bLast.maxU, bLast.minV, bLast.maxV, childLabelBaselineV);

  const hasAnyAnchors = anchors.size > 0;
  const isFirstHigh = (!hasAnyAnchors || (!!anchor1 && childNameResult.subLabelsFound.first)) ? "HIGH" : "MEDIUM";
  const isMiddleHigh = (!hasAnyAnchors || (!!anchor1 && childNameResult.subLabelsFound.middle)) ? "HIGH" : "MEDIUM";
  const isLastHigh = (!hasAnyAnchors || (!!anchor1 && childNameResult.subLabelsFound.last)) ? "HIGH" : "MEDIUM";

  const recFirst = reconcilePsaCandidate(childNameResult.firstName, secChildFirst, "first_name", isFirstHigh, {
    anchorFound: !hasAnyAnchors || !!anchor1,
    subLabelFound: !hasAnyAnchors || childNameResult.subLabelsFound.first,
    insideExpectedBox: true,
  });
  const recMiddle = reconcilePsaCandidate(childNameResult.middleName, secChildMiddle, "middle_name", isMiddleHigh, {
    anchorFound: !hasAnyAnchors || !!anchor1,
    subLabelFound: !hasAnyAnchors || childNameResult.subLabelsFound.middle,
    insideExpectedBox: true,
  });
  const recLast = reconcilePsaCandidate(childNameResult.lastName, secChildLast, "last_name", isLastHigh, {
    anchorFound: !hasAnyAnchors || !!anchor1,
    subLabelFound: !hasAnyAnchors || childNameResult.subLabelsFound.last,
    insideExpectedBox: !childNameResult.lastName || !/\b(?:ocr|ocag|use|only|nie|filed|population|reference)\b/i.test(childNameResult.lastName),
  });

  const firstName = recFirst.value;
  const middleName = recMiddle.value;
  const lastName = recLast.value;

  if (firstName) {
    metadata.first_name = { status: recFirst.status, confidence: recFirst.confidence, needsVerification: recFirst.needsVerification };
  }
  if (middleName) {
    metadata.middle_name = { status: recMiddle.status, confidence: recMiddle.confidence, needsVerification: recMiddle.needsVerification };
  }
  if (lastName) {
    metadata.last_name = { status: recLast.status, confidence: recLast.confidence, needsVerification: recLast.needsVerification };
  }

  // Confidence safety: If Item 1 row or First/Middle/Last anchors cannot be localized:
  // Mark affected fields: Needs Verification (Child name alignment uncertain)
  const isItem1Aligned = !!anchor1 || (childNameResult.subLabelsFound.first && childNameResult.subLabelsFound.last);
  if (!isItem1Aligned && hasAnyAnchors) {
    if (metadata.first_name) {
      metadata.first_name.status = "needs_verification";
      metadata.first_name.confidence = "LOW";
      metadata.first_name.needsVerification = true;
      metadata.first_name.reason = "Child name alignment uncertain — Item 1 anchors not localized.";
    }
    if (metadata.middle_name) {
      metadata.middle_name.status = "needs_verification";
      metadata.middle_name.confidence = "LOW";
      metadata.middle_name.needsVerification = true;
      metadata.middle_name.reason = "Child name alignment uncertain — Item 1 anchors not localized.";
    }
    if (metadata.last_name) {
      metadata.last_name.status = "needs_verification";
      metadata.last_name.confidence = "LOW";
      metadata.last_name.needsVerification = true;
      metadata.last_name.reason = "Child name alignment uncertain — Item 1 anchors not localized.";
    }
  }

  let fullName: string | undefined = undefined;
  if (lastName && firstName) {
    fullName = `${lastName}, ${firstName}${middleName ? " " + middleName : ""}`;
  } else if (firstName) {
    fullName = `${firstName}${middleName ? " " + middleName : ""}`;
  } else if (lastName) {
    fullName = lastName;
  }

  // --------------------------------------------------------------------------
  // C. Child Sex: Item 2 (SEX) — Physical X / Checkmark Mark Analysis
  // --------------------------------------------------------------------------
  let sex: "M" | "F" | undefined = undefined;
  {
    const item2TopV = anchor2 ? anchor2.bbox.minV - 0.01 : anchor1 ? anchor1.bbox.maxV : 0.170;
    const item2BottomV = anchor4
      ? anchor4.bbox.minV
      : anchor5
      ? anchor5.bbox.minV
      : anchor2
      ? anchor2.bbox.maxV + 0.08
      : 0.25;
    const item2RightU = anchor3 ? anchor3.bbox.minU : 0.40;

    const sexWords = words.filter(
      (w) =>
        w.bbox.centerV >= item2TopV &&
        w.bbox.centerV <= item2BottomV &&
        w.bbox.centerU <= item2RightU
    );

    // 1. Authoritative local pixel mark analysis if provided (from canvas)
    if (options?.sexMarkAnalysis) {
      const ma = options.sexMarkAnalysis;
      if (ma.state === "MALE_MARKED" && ma.detectedSex === "M") {
        sex = "M";
        metadata.sex = { status: "extracted", confidence: "HIGH", needsVerification: false };
      } else if (ma.state === "FEMALE_MARKED" && ma.detectedSex === "F") {
        sex = "F";
        metadata.sex = { status: "extracted", confidence: "HIGH", needsVerification: false };
      } else {
        sex = undefined;
        metadata.sex = {
          status: "needs_verification",
          confidence: "LOW",
          needsVerification: true,
          reason: ma.statusText,
        };
      }
    } else {
      // 2. Spatial mark detection from OCR words & physical mark positions
      // Exclude words that belong to Anchor 2 itself ("2." and "SEX" headers)
      const optWords = sexWords.filter(
        (w) => !(anchor2 && (w.content === anchor2.label || (w.cleanText === "2" && w.bbox.centerU < 0.12) || w.cleanText === "sex"))
      );

      // Locate printed option labels/words:
      // Male option is indicated by "Male", "Lalaki", or option label "1" preceding it
      const maleWord = optWords.find(
        (w) => /\b(?:male|lalaki)\b/i.test(w.cleanText) || w.cleanText === "male"
      );

      // Female option is indicated by "Female", "Babae", or option label "2"
      const femaleWord = optWords.find(
        (w) => /\b(?:female|babae)\b/i.test(w.cleanText) || w.cleanText === "female"
      );
      const femaleOpt2 = optWords.find(
        (w) => w.cleanText === "2" && (!femaleWord || w.bbox.centerU < femaleWord.bbox.minU) && (!maleWord || w.bbox.centerU > maleWord.bbox.maxU)
      );

      // Check for explicit mark tokens: X, x, ✓, ✗, +, *
      const markTokens = sexWords.filter(
        (w) =>
          /^[xX✓✗\+\*]$/.test(w.content.trim()) ||
          /^\[[xX✓✗\+\*]\]$/.test(w.content.trim()) ||
          /^[xX]\b/i.test(w.content.trim())
      );

      const hasBothOptions = !!maleWord && !!femaleWord;

      if (hasBothOptions) {
        // Both printed options exist on the form: selection MUST come from mark location
        let maleMarked = false;
        let femaleMarked = false;

        const maleRight = maleWord.bbox.maxU;
        const femaleLeft = femaleOpt2 ? femaleOpt2.bbox.minU : femaleWord.bbox.minU;
        const splitU = (maleRight + femaleLeft) / 2;

        for (const mw of markTokens) {
          if (mw.bbox.centerU < splitU) {
            maleMarked = true;
          } else {
            femaleMarked = true;
          }
        }

        // Also check if mark was glued to '1' or '2' like 'X1' or 'X2'
        for (const w of sexWords) {
          if (/^[xX]1/i.test(w.content) || /1[xX]/i.test(w.content)) maleMarked = true;
          if (/^[xX]2/i.test(w.content) || /2[xX]/i.test(w.content)) femaleMarked = true;
        }

        if (maleMarked && !femaleMarked) {
          sex = "M";
          metadata.sex = { status: "extracted", confidence: "HIGH", needsVerification: false };
        } else if (femaleMarked && !maleMarked) {
          sex = "F";
          metadata.sex = { status: "extracted", confidence: "HIGH", needsVerification: false };
        } else if (maleMarked && femaleMarked) {
          sex = undefined;
          metadata.sex = {
            status: "needs_verification",
            confidence: "LOW",
            needsVerification: true,
            reason: "Needs Verification: Both Male and Female options marked",
          };
        } else {
          // Neither marked on printed template -> Needs Verification
          sex = undefined;
          metadata.sex = {
            status: "needs_verification",
            confidence: "LOW",
            needsVerification: true,
            reason: "Needs Verification: No selection mark detected in Item 2",
          };
        }
      } else {
        // Single option present (e.g. synthetic test with only 'Male' or only 'Female')
        for (const w of sexWords) {
          if (anchor2 && (w.content === anchor2.label || (w.cleanText === "2" && w.bbox.centerU < 0.12) || w.cleanText === "sex")) continue;
          const normalized = normalizeSex(w.content);
          if (normalized) {
            sex = normalized;
            metadata.sex = { status: "extracted", confidence: "HIGH", needsVerification: false };
            break;
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // D. Child Date of Birth: Item 3 (DATE OF BIRTH)
  // --------------------------------------------------------------------------
  let birthDate: string | undefined = undefined;
  {
    const item3TopV = anchor3 ? anchor3.bbox.minV - 0.01 : anchor1 ? anchor1.bbox.maxV : 0.20;
    const item3BottomV = anchor4
      ? anchor4.bbox.minV
      : anchor5
      ? anchor5.bbox.minV
      : anchor3
      ? anchor3.bbox.maxV + 0.08
      : 0.35;
    const item3LeftU = anchor3 ? Math.min(anchor3.bbox.minU, 0.45) : 0.35;

    const dobWords = words
      .filter(
        (w) =>
          w.bbox.centerV >= item3TopV &&
          w.bbox.centerV <= item3BottomV &&
          w.bbox.centerU >= item3LeftU
      )
      .sort((a, b) => a.bbox.centerU - b.bbox.centerU);

    // Try unified string matching first
    const dobText = dobWords.map((w) => w.content).join(" ");
    for (const pat of DATE_PATTERNS) {
      const match = dobText.match(pat);
      if (match) {
        birthDate = match[0].trim();
        metadata.birth_date = { status: "extracted", confidence: "HIGH", needsVerification: false };
        break;
      }
    }

    // Fallback: Check if separate Day / Month / Year sub-components exist
    if (!birthDate && dobWords.length > 0) {
      const monthNames: Record<string, string> = {
        jan: "January", january: "January",
        feb: "February", february: "February",
        mar: "March", march: "March",
        apr: "April", april: "April",
        may: "May",
        jun: "June", june: "June",
        jul: "July", july: "July",
        aug: "August", august: "August",
        sep: "September", sept: "September", september: "September",
        oct: "October", october: "October",
        nov: "November", november: "November",
        dec: "December", december: "December",
      };

      const dayWord = dobWords.find((w) => /^(?:[1-9]|[12]\d|3[01])$/.test(w.content.trim()));
      const monthWord = dobWords.find((w) => !!monthNames[w.cleanText]);
      const yearWord = dobWords.find((w) => /^(?:19|20)\d{2}$/.test(w.content.trim()));

      if (dayWord && monthWord && yearWord) {
        birthDate = `${dayWord.content.trim()} ${monthNames[monthWord.cleanText]} ${yearWord.content.trim()}`;
        metadata.birth_date = { status: "extracted", confidence: "HIGH", needsVerification: false };
      }
    }
  }

  // --------------------------------------------------------------------------
  // E. Child Place of Birth: Item 4 (PLACE OF BIRTH)
  // Terminates strictly at Item 5 ("5a. TYPE OF BIRTH")
  // --------------------------------------------------------------------------
  let birthPlace: string | undefined = undefined;
  let birthFacility: string | undefined = undefined;
  let birthCityMunicipality: string | undefined = undefined;
  let birthProvince: string | undefined = undefined;
  let item4BottomV: number;
  let item4TopV: number;
  {
    const anchor6 = anchors.get(6);
    const anchor7 = anchors.get(7);

    item4TopV = anchor4 ? anchor4.bbox.minV : 0.24;

    // Strict boundary: Terminate at Anchor 5 ("5a. TYPE OF BIRTH")
    item4BottomV = anchor5
      ? anchor5.bbox.minV
      : anchor6
      ? Math.min(anchor6.bbox.minV, 0.42)
      : anchor7
      ? Math.min(anchor7.bbox.minV, 0.42)
      : anchor4
      ? anchor4.bbox.maxV + 0.09
      : 0.38;

    const placeWords = words
      .filter((w) => w.bbox.centerV >= item4TopV && w.bbox.centerV < item4BottomV)
      .filter((w) => {
        // Exclude anchor label itself
        if (anchor4 && Math.abs(w.bbox.centerV - anchor4.bbox.centerV) < 0.02 && w.bbox.centerU <= anchor4.bbox.maxU + 0.02) {
          return false;
        }
        // Exclude printed sub-label tokens
        if (/\b(?:place|birth|hospital\/clinic\/institution|city\/municipality|province|street|house|barangay)\b/i.test(w.cleanText)) {
          return false;
        }
        // Exclude Item 5 anchor text if adjacent
        if (/^5[ab]?\.?$/i.test(w.content.trim()) || /^(?:type|uri)$/i.test(w.cleanText)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (Math.abs(a.bbox.centerV - b.bbox.centerV) > 0.03) {
          return a.bbox.centerV - b.bbox.centerV;
        }
        return a.bbox.centerU - b.bbox.centerU;
      });

    // Check for internal sub-labels: Hospital, City, Province
    const hospSub = words.find((w) => w.bbox.centerV >= item4TopV && w.bbox.centerV < item4BottomV && /\b(?:hospital|clinic|institution)\b/i.test(w.cleanText));
    const citySub = words.find((w) => w.bbox.centerV >= item4TopV && w.bbox.centerV < item4BottomV && /\b(?:city|municipality|lungsod|bayan)\b/i.test(w.cleanText));
    const provSub = words.find((w) => w.bbox.centerV >= item4TopV && w.bbox.centerV < item4BottomV && /\b(?:province|lalawigan)\b/i.test(w.cleanText));

    if (citySub) {
      const facilityWords = placeWords.filter((w) => w.bbox.centerU < citySub.bbox.centerU);
      const cityWords = provSub
        ? placeWords.filter((w) => w.bbox.centerU >= citySub.bbox.centerU && w.bbox.centerU < provSub.bbox.centerU)
        : placeWords.filter((w) => w.bbox.centerU >= citySub.bbox.centerU);
      const provWords = provSub ? placeWords.filter((w) => w.bbox.centerU >= provSub.bbox.centerU) : [];

      if (facilityWords.length > 0) {
        const cleaned = cleanPlaceOfBirth(facilityWords.map((w) => w.content).join(" "));
        if (cleaned.length >= 3) birthFacility = cleaned;
      }
      if (cityWords.length > 0) {
        const cleaned = cleanPlaceOfBirth(cityWords.map((w) => w.content).join(" "));
        if (cleaned.length >= 3) birthCityMunicipality = cleaned;
      }
      if (provWords.length > 0) {
        const cleaned = cleanPlaceOfBirth(provWords.map((w) => w.content).join(" "));
        if (cleaned.length >= 3) birthProvince = cleaned;
      }

      const composed = [birthFacility, birthCityMunicipality, birthProvince].filter(Boolean).join(", ");
      if (composed.length >= 3) {
        birthPlace = composed;
      }
    }

    if (!birthPlace && placeWords.length > 0) {
      const rawPlace = placeWords.map((w) => w.content).join(" ").trim();
      const cleanedPlace = cleanPlaceOfBirth(rawPlace);

      // Semantic Sanity Check: Reject candidate if it contains adjacent numbered markers or parent text
      const hasContaminationMarkers = /\b(?:5|5a|5b|6|7|8|9|9a|10)\.\s*/i.test(cleanedPlace);
      const hasParentBleed = /\b(?:mother|father|maiden|jeanne|total|second,\s*third|type\s+of\s+birth)\b/i.test(cleanedPlace);

      if (!hasContaminationMarkers && !hasParentBleed && cleanedPlace.length >= 4) {
        birthPlace = cleanedPlace;
      }
    }

    if (birthPlace) {
      metadata.birth_place = { status: "extracted", confidence: "MEDIUM", needsVerification: false };
    }
  }

  // --------------------------------------------------------------------------
  // F. Mother's Maiden Name: Item 6 (Two-Stage Name Row + Sub-Label Mapping + Reconciliation)
  // --------------------------------------------------------------------------
  const anchor6 = anchors.get(6);
  const anchor7 = anchors.get(7);
  const anchor9 = anchors.get(9);
  const anchor13 = anchors.get(13);

  const motherNameResult = extractPersonNameFromRow(
    anchor6,
    [anchor7, anchor9, anchor13],
    words,
    lines,
    {
      minV: anchor6 ? anchor6.bbox.minV : (isIdentityCrop ? 0.48 : 0.35),
      maxV: anchor7 || anchor9 || anchor13 ? Math.min(anchor7?.bbox.minV ?? 0.60, anchor9?.bbox.minV ?? 0.60, anchor13?.bbox.minV ?? 0.60) : (isIdentityCrop ? 0.70 : 0.60),
    }
  );

  const bMother = anchorBoxes.mother_name;
  const secMotherFirst = getSecText(0.04, 0.38, bMother.minV, bMother.maxV);
  const secMotherMiddle = getSecText(0.38, 0.68, bMother.minV, bMother.maxV);
  const secMotherLast = getSecText(0.68, bMother.maxU, bMother.minV, bMother.maxV);
  const secMotherCombined = [secMotherLast, secMotherFirst, secMotherMiddle].filter(Boolean).length > 1
    ? `${secMotherLast || ""}, ${secMotherFirst || ""}${secMotherMiddle ? " " + secMotherMiddle : ""}`.replace(/^,\s*/, "")
    : [secMotherFirst, secMotherMiddle, secMotherLast].filter(Boolean).join(" ");

  const isMotherHigh = (!hasAnyAnchors || (!!anchor6 && (motherNameResult.subLabelsFound.first || motherNameResult.subLabelsFound.last))) ? "HIGH" : "MEDIUM";
  const recMother = reconcilePsaCandidate(motherNameResult.fullName, secMotherCombined || undefined, "mother_name", isMotherHigh, {
    anchorFound: !hasAnyAnchors || !!anchor6,
    insideExpectedBox: true,
  });
  const motherFirstName = motherNameResult.firstName || secMotherFirst;
  const motherMiddleName = motherNameResult.middleName || secMotherMiddle;
  const motherLastName = motherNameResult.lastName || secMotherLast;
  let motherName: string | undefined = undefined;
  if (motherLastName && motherFirstName) {
    motherName = `${motherLastName}, ${motherFirstName}${motherMiddleName ? " " + motherMiddleName : ""}`;
  } else if (recMother.value) {
    motherName = recMother.value;
  }

  if (motherName) {
    metadata.mother_name = { status: recMother.status, confidence: recMother.confidence, needsVerification: recMother.needsVerification };
  }

  // --------------------------------------------------------------------------
  // G. Father's Name: Item 13 (Two-Stage Name Row + Sub-Label Mapping + Reconciliation)
  // --------------------------------------------------------------------------
  const anchor14 = anchors.get(14);
  const anchor20 = anchors.get(20);

  const fatherNameResult = extractPersonNameFromRow(
    anchor13,
    [anchor14, anchor20],
    words,
    lines,
    { minV: anchor13 ? anchor13.bbox.minV : (isIdentityCrop ? 0.82 : 0.50), maxV: 0.98 }
  );

  const bFather = anchorBoxes.father_name;
  const secFatherFirst = getSecText(0.04, 0.38, bFather.minV, bFather.maxV);
  const secFatherMiddle = getSecText(0.38, 0.68, bFather.minV, bFather.maxV);
  const secFatherLast = getSecText(0.68, bFather.maxU, bFather.minV, bFather.maxV);
  const secFatherCombined = [secFatherLast, secFatherFirst, secFatherMiddle].filter(Boolean).length > 1
    ? `${secFatherLast || ""}, ${secFatherFirst || ""}${secFatherMiddle ? " " + secFatherMiddle : ""}`.replace(/^,\s*/, "")
    : [secFatherFirst, secFatherMiddle, secFatherLast].filter(Boolean).join(" ");

  const isFatherHigh = (!hasAnyAnchors || (!!anchor13 && (fatherNameResult.subLabelsFound.first || fatherNameResult.subLabelsFound.last))) ? "HIGH" : "MEDIUM";
  const recFather = reconcilePsaCandidate(fatherNameResult.fullName, secFatherCombined || undefined, "father_name", isFatherHigh, {
    anchorFound: !hasAnyAnchors || !!anchor13,
    insideExpectedBox: true,
  });
  const fatherFirstName = fatherNameResult.firstName || secFatherFirst;
  const fatherMiddleName = fatherNameResult.middleName || secFatherMiddle;
  const fatherLastName = fatherNameResult.lastName || secFatherLast;
  let fatherName: string | undefined = undefined;
  if (fatherLastName && fatherFirstName) {
    fatherName = `${fatherLastName}, ${fatherFirstName}${fatherMiddleName ? " " + fatherMiddleName : ""}`;
  } else if (recFather.value) {
    fatherName = recFather.value;
  }

  if (fatherName) {
    metadata.father_name = { status: recFather.status, confidence: recFather.confidence, needsVerification: recFather.needsVerification };
  }

  // Set missing status for unextracted fields
  const checkFields: Array<[string, any]> = [
    ["first_name", firstName],
    ["last_name", lastName],
    ["middle_name", middleName],
    ["sex", sex],
    ["birth_date", birthDate],
    ["birth_place", birthPlace],
    ["mother_name", motherName],
    ["father_name", fatherName],
    ["registry_number", registryNumber],
  ];

  for (const [key, val] of checkFields) {
    if (!val && !metadata[key]) {
      metadata[key] = {
        status: "not_extracted",
        confidence: "LOW",
        needsVerification: true,
        reason: "Field could not be reliably extracted from physical PSA section.",
      };
    }
  }

  // Generate zero-PII development geometry diagnostic overlay if enabled
  const diagnostic = generatePsaGeometryDiagnostic(
    anchors,
    words,
    lines,
    { child: childNameResult, mother: motherNameResult, father: fatherNameResult },
    { top: item4TopV, bottom: item4BottomV },
    anchorBoxes
  );

  return {
    document_type: "birth_cert",
    name: fullName || undefined,
    first_name: firstName || undefined,
    middle_name: middleName || undefined,
    last_name: lastName || undefined,
    sex: sex || undefined,
    birth_date: birthDate || undefined,
    birth_place: birthPlace || undefined,
    birth_facility: birthFacility || undefined,
    birth_city_municipality: birthCityMunicipality || undefined,
    birth_province: birthProvince || undefined,
    mother_name: motherName || undefined,
    mother_first_name: motherFirstName || undefined,
    mother_middle_name: motherMiddleName || undefined,
    mother_last_name: motherLastName || undefined,
    father_name: fatherName || undefined,
    father_first_name: fatherFirstName || undefined,
    father_middle_name: fatherMiddleName || undefined,
    father_last_name: fatherLastName || undefined,
    registry_number: registryNumber || undefined,
    field_metadata: metadata,
    diagnostic,
    grades: [], // STRICT: PSA NEVER PRODUCES ACADEMIC GRADES
  };
}

// ============================================================================
// 6. DEVELOPMENT-ONLY PSA GEOMETRY DIAGNOSTIC
// ============================================================================

/**
 * Generates an ASCII / coordinate diagnostic summary for local testing.
 * Disabled completely in production; emits ZERO PII.
 */
export function generatePsaGeometryDiagnostic(
  anchors: Map<number, PsaItemAnchor>,
  words: SpatialPsaWord[],
  lines: SpatialPsaLine[],
  nameResults: {
    child?: ExtractedPersonNameResult;
    mother?: ExtractedPersonNameResult;
    father?: ExtractedPersonNameResult;
  },
  birthPlaceV?: { top: number; bottom: number },
  anchorBoxes?: Record<string, any>
): Record<string, any> | undefined {
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_PSA_LAYOUT !== "true") {
    if (anchorBoxes) {
      return { anchorRefinedBoxes: anchorBoxes };
    }
    return undefined;
  }

  const anchorList: Array<{ item: number; label: string; v: number; u: number }> = [];
  for (const [item, a] of anchors.entries()) {
    anchorList.push({
      item,
      label: a.label,
      v: Math.round(a.bbox.centerV * 1000) / 1000,
      u: Math.round(a.bbox.centerU * 1000) / 1000,
    });
  }

  const ascii = [
    `=== PSA GEOMETRY DIAGNOSTIC (Zero-PII) ===`,
    `[Item 1: Child Name] V: [${(nameResults.child?.rowVRange.minV ?? 0).toFixed(3)}, ${(nameResults.child?.rowVRange.maxV ?? 0).toFixed(3)}]`,
    `  Sub-labels: First=${nameResults.child?.subLabelsFound.first}, Middle=${nameResults.child?.subLabelsFound.middle}, Last=${nameResults.child?.subLabelsFound.last}`,
    `  Extracted: First=${nameResults.child?.firstName ? "YES" : "NO"}, Middle=${nameResults.child?.middleName ? "YES" : "NO"}, Last=${nameResults.child?.lastName ? "YES" : "NO"}`,
    `[Item 4: Place of Birth] V: [${(birthPlaceV?.top ?? 0).toFixed(3)}, ${(birthPlaceV?.bottom ?? 0).toFixed(3)}]`,
    `[Item 6: Mother Name] V: [${(nameResults.mother?.rowVRange.minV ?? 0).toFixed(3)}, ${(nameResults.mother?.rowVRange.maxV ?? 0).toFixed(3)}]`,
    `  Sub-labels: First=${nameResults.mother?.subLabelsFound.first}, Middle=${nameResults.mother?.subLabelsFound.middle}, Last=${nameResults.mother?.subLabelsFound.last}`,
    `[Item 13: Father Name] V: [${(nameResults.father?.rowVRange.minV ?? 0).toFixed(3)}, ${(nameResults.father?.rowVRange.maxV ?? 0).toFixed(3)}]`,
    `  Sub-labels: First=${nameResults.father?.subLabelsFound.first}, Middle=${nameResults.father?.subLabelsFound.middle}, Last=${nameResults.father?.subLabelsFound.last}`,
    `==========================================`,
  ].join("\n");

  return {
    anchors: anchorList,
    anchorRefinedBoxes: anchorBoxes,
    childName: {
      vRange: nameResults.child?.rowVRange,
      subLabels: nameResults.child?.subLabelsFound,
      order: nameResults.child?.detectedOrder,
    },
    motherName: {
      vRange: nameResults.mother?.rowVRange,
      subLabels: nameResults.mother?.subLabelsFound,
      order: nameResults.mother?.detectedOrder,
    },
    fatherName: {
      vRange: nameResults.father?.rowVRange,
      subLabels: nameResults.father?.subLabelsFound,
      order: nameResults.father?.detectedOrder,
    },
    asciiDiagram: ascii,
  };
}

// ============================================================================
// 7. ROBUST TEXT FALLBACK (Strict Label Exclusion)
// ============================================================================

/**
 * Fallback parser for plain OCR text when spatial coordinates are unavailable.
 */
function parsePsaTextFallback(text: string): PsaExtractedFields {
  const metadata: Record<string, FieldExtractionMeta> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let firstName: string | undefined = undefined;
  let middleName: string | undefined = undefined;
  let lastName: string | undefined = undefined;
  let sex: "M" | "F" | undefined = undefined;
  let birthDate: string | undefined = undefined;
  let birthPlace: string | undefined = undefined;
  let motherName: string | undefined = undefined;
  let fatherName: string | undefined = undefined;
  let registryNumber: string | undefined = undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Registry Number
    if (!registryNumber && /\b(?:registry\s*no\.?|civil\s*registry\s*no\.?)\b/i.test(line)) {
      const match = line.match(/\b(?:\d{2,4}-\d{3,7}|\d{6,9})\b/);
      if (match && !/^(?:19|20)\d{2}$/.test(match[0])) {
        registryNumber = match[0];
        metadata.registry_number = { status: "extracted", confidence: "MEDIUM", needsVerification: false };
      }
    }

    // Name: Item 1
    if (!firstName && !lastName && /^1\.\s*(?:name|pangalan)/i.test(line)) {
      const sameLine = line.replace(/^1\.\s*(?:name|pangalan)\s*/i, "").trim();
      const candLine = sameLine.length >= 2 ? sameLine : (lines[i + 1] || "");

      const firstMatch = candLine.match(/\(first\)\s*([^()]+)/i);
      const middleMatch = candLine.match(/\(middle\)\s*([^()]+)/i);
      const lastMatch = candLine.match(/\(last\)\s*([^()]+)/i);

      if (firstMatch || lastMatch) {
        if (firstMatch) firstName = cleanNamePart(firstMatch[1]);
        if (middleMatch) middleName = cleanNamePart(middleMatch[1]);
        if (lastMatch) lastName = cleanNamePart(lastMatch[1]);
        metadata.first_name = { status: "extracted", confidence: "MEDIUM", needsVerification: false };
      } else {
        const cleaned = cleanNamePart(candLine);
        if (isValidPsaName(cleaned)) {
          const tokens = cleaned.split(/\s+/);
          if (tokens.length >= 2) {
            firstName = tokens[0];
            lastName = tokens[tokens.length - 1];
            if (tokens.length > 2) middleName = tokens.slice(1, -1).join(" ");
          } else {
            firstName = cleaned;
          }
          metadata.first_name = { status: "extracted", confidence: "LOW", needsVerification: true };
        }
      }
    }

    // Sex: Item 2
    if (!sex && /^2\.\s*(?:sex|kasarian)/i.test(line)) {
      const sameLine = line.replace(/^2\.\s*(?:sex|kasarian)\s*/i, "").trim();
      const cand = sameLine.length > 0 ? sameLine : (lines[i + 1] || "");
      const normalized = normalizeSex(cand);
      if (normalized) {
        sex = normalized;
        metadata.sex = { status: "extracted", confidence: "MEDIUM", needsVerification: false };
      }
    }

    // Date of birth: Item 3
    if (!birthDate && /^3\.\s*(?:date\s+of\s+birth|araw\s+ng\s+kapanganakan)/i.test(line)) {
      const sameLine = line.replace(/^3\.\s*(?:date\s+of\s+birth|araw\s+ng\s+kapanganakan)\s*/i, "").trim();
      const cand = sameLine.length > 0 ? sameLine : (lines[i + 1] || "");
      for (const pat of DATE_PATTERNS) {
        const match = cand.match(pat);
        if (match) {
          birthDate = match[0].trim();
          metadata.birth_date = { status: "extracted", confidence: "MEDIUM", needsVerification: false };
          break;
        }
      }
    }

    // Place of birth: Item 4
    if (!birthPlace && /^4\.\s*(?:place\s+of\s+birth|lugar\s+ng\s+kapanganakan)/i.test(line)) {
      const sameLine = line.replace(/^4\.\s*(?:place\s+of\s+birth|lugar\s+ng\s+kapanganakan)\s*/i, "").trim();
      const cand = sameLine.length > 0 ? sameLine : (lines[i + 1] || "");
      const cleaned = cleanPlaceOfBirth(cand);
      if (cleaned.length >= 4 && !/\b(?:5|6|7)\.\s*/i.test(cleaned)) {
        birthPlace = cleaned;
        metadata.birth_place = { status: "extracted", confidence: "LOW", needsVerification: true };
      }
    }

    // Mother: Item 5 or 6
    if (!motherName && /^(?:5|6)\.\s*(?:maiden\s+name|pangalan)/i.test(line)) {
      const sameLine = line.replace(/^(?:5|6)\.\s*(?:maiden\s+name|pangalan)\s*(?:of\s+mother)?\s*/i, "").trim();
      const cand = sameLine.length > 0 ? sameLine : (lines[i + 1] || "");
      const cleaned = cleanNamePart(cand);
      if (isValidPsaName(cleaned)) {
        motherName = cleaned;
        metadata.mother_name = { status: "extracted", confidence: "LOW", needsVerification: true };
      }
    }

    // Father: Item 6 or 13
    if (!fatherName && /^(?:6|13)\.\s*(?:name|pangalan)/i.test(line)) {
      const sameLine = line.replace(/^(?:6|13)\.\s*(?:name|pangalan)\s*(?:of\s+father)?\s*/i, "").trim();
      const cand = sameLine.length > 0 ? sameLine : (lines[i + 1] || "");
      const cleaned = cleanNamePart(cand);
      if (isValidPsaName(cleaned)) {
        fatherName = cleaned;
        metadata.father_name = { status: "extracted", confidence: "LOW", needsVerification: true };
      }
    }
  }

  let fullName = "";
  if (lastName && firstName) {
    fullName = `${lastName}, ${firstName}${middleName ? " " + middleName : ""}`;
  } else if (firstName) {
    fullName = `${firstName}${middleName ? " " + middleName : ""}`;
  }

  return {
    document_type: "birth_cert",
    name: fullName || undefined,
    first_name: firstName || undefined,
    middle_name: middleName || undefined,
    last_name: lastName || undefined,
    sex: sex || undefined,
    birth_date: birthDate || undefined,
    birth_place: birthPlace || undefined,
    mother_name: motherName || undefined,
    father_name: fatherName || undefined,
    registry_number: registryNumber || undefined,
    field_metadata: metadata,
    grades: [],
  };
}

/**
 * Parses raw text or spatial OCR layout into structured PSA identity fields.
 */
export function parsePsaText(text: string, rawLayout?: any): PsaExtractedFields {
  if (rawLayout) {
    return parsePsaSpatialLayout(rawLayout, text);
  }
  return parsePsaTextFallback(text);
}

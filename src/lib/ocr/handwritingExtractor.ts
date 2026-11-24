/**
 * AVV System — Intelligent Character Recognition (ICR) & Handwriting Extractor
 *
 * Utilizes Microsoft Azure AI Document Intelligence style analysis to distinguish:
 * 1. Printed text (OCR)
 * 2. Handwritten text (ICR)
 * 3. Mixed fields
 *
 * Preserves:
 * - Word-level confidence
 * - Source bounding polygons
 * - Source page numbers
 * - Traceability metadata for human reviewer verification
 */

export type RecognitionType = "printed" | "handwritten" | "mixed" | "unknown";

export interface RecognizedWordMeta {
  content: string;
  polygon?: number[];
  confidence?: number;
  isHandwritten: boolean;
  styleConfidence?: number;
  pageNumber: number;
}

export interface FieldRecognitionMeta {
  recognition_type: RecognitionType;
  is_handwritten: boolean;
  confidence?: number;
  icr_confidence?: number;
  style_confidence?: number;
  bounding_box?: number[];
  page_number?: number;
  word_count: number;
  handwritten_word_count: number;
  printed_word_count: number;
  source_words?: RecognizedWordMeta[];
}

export type FieldRecognitionClassification = FieldRecognitionMeta;

export interface DocumentRecognitionSummary {
  ocr_provider: string;
  ocr_model: string;
  icr_available: boolean;
  has_handwriting: boolean;
  handwritten_word_count: number;
  printed_word_count: number;
  total_word_count: number;
  handwriting_ratio: number;
  overall_confidence?: number;
  handwriting_confidence?: number;
  printed_confidence?: number;
  requires_teacher_icr_review: boolean;
}

/**
 * Normalizes text for fuzzy token matching.
 */
function cleanToken(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9ñ]/gi, "").trim();
}

/**
 * Classifies an extracted field value as printed (OCR) or handwritten (ICR)
 * based on Azure Document Intelligence style spans and word layout.
 */
export function classifyFieldRecognition(
  fieldValue: string | number | undefined | null,
  rawLayout?: any
): FieldRecognitionMeta {
  if (fieldValue === undefined || fieldValue === null || String(fieldValue).trim().length === 0) {
    return {
      recognition_type: "unknown",
      is_handwritten: false,
      word_count: 0,
      handwritten_word_count: 0,
      printed_word_count: 0,
    };
  }

  const valueStr = String(fieldValue).trim();
  const valueTokens = valueStr.split(/\s+/).map(cleanToken).filter(Boolean);

  if (!rawLayout || !Array.isArray(rawLayout.words) || rawLayout.words.length === 0 || valueTokens.length === 0) {
    return {
      recognition_type: "unknown",
      is_handwritten: false,
      word_count: valueTokens.length,
      handwritten_word_count: 0,
      printed_word_count: 0,
    };
  }

  const allWords: RecognizedWordMeta[] = rawLayout.words;
  const matchedWords: RecognizedWordMeta[] = [];

  // Match tokens against recognized words in layout
  for (const token of valueTokens) {
    let bestMatch: RecognizedWordMeta | undefined = undefined;

    for (const w of allWords) {
      const wClean = cleanToken(w.content);
      if (wClean === token) {
        bestMatch = w;
        break;
      }
      if (token.length >= 3 && (wClean.includes(token) || token.includes(wClean))) {
        if (!bestMatch) bestMatch = w;
      }
    }

    if (bestMatch && !matchedWords.includes(bestMatch)) {
      matchedWords.push(bestMatch);
    }
  }

  // If no direct token match, check substring matches across lines
  if (matchedWords.length === 0 && Array.isArray(rawLayout.pages)) {
    for (const page of rawLayout.pages) {
      if (Array.isArray(page.lines)) {
        for (const line of page.lines) {
          if (line.content && line.content.toLowerCase().includes(valueStr.toLowerCase())) {
            // Find words belonging to this page that overlap line content
            const lineWords = (page.words || []).filter((w: any) =>
              valueTokens.some((t) => cleanToken(w.content).includes(t) || t.includes(cleanToken(w.content)))
            );
            matchedWords.push(...lineWords);
            break;
          }
        }
      }
      if (matchedWords.length > 0) break;
    }
  }

  const hwWords = matchedWords.filter((w) => w.isHandwritten);
  const printedWords = matchedWords.filter((w) => !w.isHandwritten);

  let recognitionType: RecognitionType = "unknown";
  if (matchedWords.length > 0) {
    if (hwWords.length === matchedWords.length) {
      recognitionType = "handwritten";
    } else if (printedWords.length === matchedWords.length) {
      recognitionType = "printed";
    } else {
      recognitionType = "mixed";
    }
  }

  // Calculate average confidence across matched words
  const confidences = matchedWords
    .map((w) => w.confidence)
    .filter((c): c is number => typeof c === "number" && !isNaN(c));
  const avgConfidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10000) / 10000
      : undefined;

  // Extract bounding envelope polygon
  let boundingBox: number[] | undefined = undefined;
  if (matchedWords.length > 0) {
    const allX: number[] = [];
    const allY: number[] = [];

    for (const w of matchedWords) {
      if (Array.isArray(w.polygon) && w.polygon.length >= 4) {
        for (let i = 0; i < w.polygon.length; i += 2) {
          allX.push(w.polygon[i]);
          if (i + 1 < w.polygon.length) allY.push(w.polygon[i + 1]);
        }
      }
    }

    if (allX.length > 0 && allY.length > 0) {
      const minX = Math.min(...allX);
      const maxX = Math.max(...allX);
      const minY = Math.min(...allY);
      const maxY = Math.max(...allY);
      boundingBox = [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
    }
  }

  const primaryPage = matchedWords.length > 0 ? matchedWords[0].pageNumber : 1;
  const styleConfidences = hwWords
    .map((w) => w.styleConfidence)
    .filter((c): c is number => typeof c === "number");
  const avgStyleConfidence =
    styleConfidences.length > 0
      ? Math.round((styleConfidences.reduce((a, b) => a + b, 0) / styleConfidences.length) * 10000) / 10000
      : undefined;

  return {
    recognition_type: recognitionType,
    is_handwritten: hwWords.length > 0,
    confidence: avgConfidence,
    icr_confidence: avgStyleConfidence ?? avgConfidence,
    style_confidence: avgStyleConfidence,
    bounding_box: boundingBox,
    page_number: primaryPage,
    word_count: matchedWords.length || valueTokens.length,
    handwritten_word_count: hwWords.length,
    printed_word_count: printedWords.length,
    source_words: matchedWords,
  };
}

/**
 * Builds a comprehensive recognition and ICR summary for the entire document.
 */
export function buildDocumentRecognitionSummary(
  rawLayout?: any,
  provider: string = "azure",
  model: string = "azure/prebuilt-read"
): DocumentRecognitionSummary {
  const isAzure = (provider || "").toLowerCase().includes("azure");
  const words: RecognizedWordMeta[] = Array.isArray(rawLayout?.words) ? rawLayout.words : [];

  const hwCount = typeof rawLayout?.handwrittenWordCount === "number"
    ? rawLayout.handwrittenWordCount
    : words.filter((w) => w.isHandwritten).length;

  const prCount = typeof rawLayout?.printedWordCount === "number"
    ? rawLayout.printedWordCount
    : words.filter((w) => !w.isHandwritten).length;

  const totalWords = hwCount + prCount;
  const hwRatio = totalWords > 0 ? Math.round((hwCount / totalWords) * 10000) / 10000 : 0;

  const hwConfidence = rawLayout?.handwritingConfidence;
  const prConfidence = rawLayout?.printedConfidence;

  // ICR review is required if document has handwritten words with moderate or uncertain confidence
  const requiresReview = hwCount > 0 && (hwConfidence === undefined || hwConfidence < 0.88);

  return {
    ocr_provider: provider,
    ocr_model: model,
    icr_available: isAzure && Array.isArray(rawLayout?.styles),
    has_handwriting: hwCount > 0,
    handwritten_word_count: hwCount,
    printed_word_count: prCount,
    total_word_count: totalWords,
    handwriting_ratio: hwRatio,
    overall_confidence: rawLayout?.overallConfidence,
    handwriting_confidence: hwConfidence,
    printed_confidence: prConfidence,
    requires_teacher_icr_review: requiresReview,
  };
}

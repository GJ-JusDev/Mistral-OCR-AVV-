import zlib from "zlib";

/**
 * Unescape PDF literal string special sequences.
 */
function unescapePdfString(str: string): string {
  return str
    .replace(/\\\\/g, "\\")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Extracts plain text across all pages from an embedded PDF buffer without external dependencies.
 */
export function extractEmbeddedPdfText(pdfBuffer: Buffer): string {
  const binaryString = pdfBuffer.toString("latin1");
  const extractedLines: string[] = [];

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(binaryString)) !== null) {
    const rawData = Buffer.from(match[1], "latin1");
    let decodedText = "";

    try {
      decodedText = zlib.inflateSync(rawData).toString("latin1");
    } catch {
      try {
        decodedText = zlib.inflateRawSync(rawData).toString("latin1");
      } catch {
        decodedText = rawData.toString("latin1");
      }
    }

    if (decodedText && (decodedText.includes("BT") || decodedText.includes("Tj") || decodedText.includes("TJ"))) {
      const btEtRegex = /BT([\s\S]*?)ET/g;
      let btMatch: RegExpExecArray | null;
      while ((btMatch = btEtRegex.exec(decodedText)) !== null) {
        const textBlock = btMatch[1];
        // Match Tj
        const tjRegex = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
        let tjMatch: RegExpExecArray | null;
        while ((tjMatch = tjRegex.exec(textBlock)) !== null) {
          extractedLines.push(unescapePdfString(tjMatch[1]));
        }
        // Match TJ arrays
        const tjArrRegex = /\[([\s\S]*?)\]\s*TJ/g;
        let arrMatch: RegExpExecArray | null;
        while ((arrMatch = tjArrRegex.exec(textBlock)) !== null) {
          const inner = arrMatch[1];
          const parts: string[] = [];
          const strRegex = /\(((?:[^()\\]|\\.)*)\)/g;
          let sMatch: RegExpExecArray | null;
          while ((sMatch = strRegex.exec(inner)) !== null) {
            parts.push(unescapePdfString(sMatch[1]));
          }
          if (parts.length > 0) {
            extractedLines.push(parts.join(" "));
          }
        }
      }
    }
  }

  return extractedLines.join("\n");
}

/**
 * Inspects a PDF buffer to estimate total page count.
 */
export function getPdfPageCount(pdfBuffer: Buffer): number {
  try {
    const rawPdf = pdfBuffer.toString("latin1");
    const countMatch = rawPdf.match(/\/Count\s+(\d+)/);
    if (countMatch) {
      const parsed = parseInt(countMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const pageObjMatches = rawPdf.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
    if (pageObjMatches && pageObjMatches.length > 0) {
      return pageObjMatches.length;
    }
  } catch {
    // fallback
  }
  return 1;
}

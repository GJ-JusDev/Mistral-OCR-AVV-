import zlib from "zlib";

/**
 * Unescape PDF literal string special sequences.
 */
export function unescapePdfString(str: string): string {
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
 * Decodes a PDF hexadecimal string (e.g. <313131353030>).
 */
export function decodePdfHexString(hex: string): string {
  const cleanHex = hex.replace(/\s+/g, "");
  let str = "";
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byteHex = cleanHex.slice(i, i + 2);
    if (byteHex.length === 1) {
      str += String.fromCharCode(parseInt(byteHex + "0", 16));
    } else {
      str += String.fromCharCode(parseInt(byteHex, 16));
    }
  }
  return str;
}

export interface ExtractedPdfTextItem {
  text: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface ExtractedPdfPage {
  pageNumber: number;
  hasEmbeddedText: boolean;
  reconstructedRows: string[];
  rawText: string;
  items?: ExtractedPdfTextItem[];
}

export interface CoordinateAwarePdfResult {
  pages: ExtractedPdfPage[];
  pageCount: number;
  fullRawText: string;
  allReconstructedRows: string[];
}

/**
 * Parses decoded PDF content stream text operators (BT..ET) to extract positioned text items.
 */
export function parseContentStreamTextItems(decodedStream: string): ExtractedPdfTextItem[] {
  const items: ExtractedPdfTextItem[] = [];
  const btEtRegex = /(?:^|\s)BT\s+([\s\S]*?)\s+ET(?:\s|$)/g;
  let btMatch: RegExpExecArray | null;

  while ((btMatch = btEtRegex.exec(decodedStream)) !== null) {
    const textBlock = btMatch[1];

    // Current text transformation matrix & line matrix state
    let tmX = 0;
    let tmY = 0;
    let tlmX = 0;
    let tlmY = 0;
    let leading = 12;

    // Tokenize stream instructions inside BT..ET
    // Commands: Tm, Td, TD, T*, TL, Tj, TJ, ', "
    const tokenRegex = /(?:(\((?:[^()\\]|\\.)*\)|<[0-9a-fA-F\s]+>|\[[\s\S]*?\]|\S+))/g;
    const tokens: string[] = [];
    let tokMatch: RegExpExecArray | null;
    while ((tokMatch = tokenRegex.exec(textBlock)) !== null) {
      tokens.push(tokMatch[1]);
    }

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];

      // a b c d e f Tm (Set text matrix and text line matrix)
      if (tok === "Tm" && i >= 6) {
        const e = parseFloat(tokens[i - 2]);
        const f = parseFloat(tokens[i - 1]);
        if (!isNaN(e) && !isNaN(f)) {
          tmX = e;
          tmY = f;
          tlmX = e;
          tlmY = f;
        }
        i++;
        continue;
      }

      // tx ty Td (Move text position)
      if (tok === "Td" && i >= 2) {
        const tx = parseFloat(tokens[i - 2]);
        const ty = parseFloat(tokens[i - 1]);
        if (!isNaN(tx) && !isNaN(ty)) {
          tlmX += tx;
          tlmY += ty;
          tmX = tlmX;
          tmY = tlmY;
        }
        i++;
        continue;
      }

      // tx ty TD (Move text position and set leading to -ty)
      if (tok === "TD" && i >= 2) {
        const tx = parseFloat(tokens[i - 2]);
        const ty = parseFloat(tokens[i - 1]);
        if (!isNaN(tx) && !isNaN(ty)) {
          leading = -ty;
          tlmX += tx;
          tlmY += ty;
          tmX = tlmX;
          tmY = tlmY;
        }
        i++;
        continue;
      }

      // T* (Move to start of next line)
      if (tok === "T*") {
        tlmY -= leading;
        tmX = tlmX;
        tmY = tlmY;
        i++;
        continue;
      }

      // leading TL (Set leading)
      if (tok === "TL" && i >= 1) {
        const lead = parseFloat(tokens[i - 1]);
        if (!isNaN(lead)) leading = lead;
        i++;
        continue;
      }

      // string Tj (Show text string)
      if (tok === "Tj" && i >= 1) {
        const strTok = tokens[i - 1];
        let textContent = "";
        if (strTok.startsWith("(") && strTok.endsWith(")")) {
          textContent = unescapePdfString(strTok.slice(1, -1));
        } else if (strTok.startsWith("<") && strTok.endsWith(">")) {
          textContent = decodePdfHexString(strTok.slice(1, -1));
        }
        if (textContent.trim().length > 0) {
          items.push({ text: textContent, x: tmX, y: tmY });
        }
        i++;
        continue;
      }

      // array TJ (Show text string with kerning/spacing)
      if (tok === "TJ" && i >= 1) {
        const arrTok = tokens[i - 1];
        if (arrTok.startsWith("[") && arrTok.endsWith("]")) {
          const inner = arrTok.slice(1, -1);
          const parts: string[] = [];
          const strRegex = /\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>/g;
          let sMatch: RegExpExecArray | null;
          while ((sMatch = strRegex.exec(inner)) !== null) {
            if (sMatch[1] !== undefined) {
              parts.push(unescapePdfString(sMatch[1]));
            } else if (sMatch[2] !== undefined) {
              parts.push(decodePdfHexString(sMatch[2]));
            }
          }
          const joined = parts.join("").trim();
          if (joined.length > 0) {
            items.push({ text: joined, x: tmX, y: tmY });
          }
        }
        i++;
        continue;
      }

      // ' string (Move to next line and show text)
      if (tok === "'" && i >= 1) {
        tlmY -= leading;
        tmX = tlmX;
        tmY = tlmY;
        const strTok = tokens[i - 1];
        let textContent = "";
        if (strTok.startsWith("(") && strTok.endsWith(")")) {
          textContent = unescapePdfString(strTok.slice(1, -1));
        }
        if (textContent.trim().length > 0) {
          items.push({ text: textContent, x: tmX, y: tmY });
        }
        i++;
        continue;
      }

      i++;
    }
  }

  return items;
}

/**
 * Reconstructs lines/rows from positioned text items by grouping elements
 * within horizontal y-coordinate proximity (~4-6pt) and sorting left-to-right by x-coordinate.
 * Multi-column table rows are cleanly joined with " | ".
 */
export function clusterAndReconstructRows(
  items: ExtractedPdfTextItem[],
  proximityPt: number = 5.0
): string[] {
  const valid = items.filter((it) => it.text && it.text.trim().length > 0);
  if (valid.length === 0) return [];

  // Group items into row clusters
  interface RowCluster {
    baseY: number;
    minY: number;
    maxY: number;
    items: ExtractedPdfTextItem[];
  }

  // Sort descending by y (top of page to bottom)
  const sorted = [...valid].sort((a, b) => b.y - a.y);
  const clusters: RowCluster[] = [];

  for (const item of sorted) {
    let matched = false;
    for (const cluster of clusters) {
      if (
        Math.abs(item.y - cluster.baseY) <= proximityPt ||
        (item.y >= cluster.minY - proximityPt && item.y <= cluster.maxY + proximityPt)
      ) {
        cluster.items.push(item);
        cluster.minY = Math.min(cluster.minY, item.y);
        cluster.maxY = Math.max(cluster.maxY, item.y);
        cluster.baseY = (cluster.minY + cluster.maxY) / 2;
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({
        baseY: item.y,
        minY: item.y,
        maxY: item.y,
        items: [item],
      });
    }
  }

  // Sort clusters descending by baseY (top to bottom reading order)
  clusters.sort((a, b) => b.baseY - a.baseY);

  const rows: string[] = [];
  for (const cluster of clusters) {
    // Sort items within cluster ascending by x (left to right)
    cluster.items.sort((a, b) => a.x - b.x);

    // Group items that are immediately adjacent into phrases, and separate columns by " | "
    const columns: string[] = [];
    let currentCellText = "";
    let lastX = -1;

    for (const it of cluster.items) {
      const clean = it.text.trim();
      if (!clean) continue;

      if (lastX === -1) {
        currentCellText = clean;
        lastX = it.x;
      } else {
        const gap = it.x - lastX;
        // If items are very close (< 10pt apart), merge within the same column cell
        if (gap < 10) {
          currentCellText = currentCellText ? `${currentCellText} ${clean}` : clean;
        } else {
          // Distinct table column
          if (currentCellText) {
            columns.push(currentCellText);
          }
          currentCellText = clean;
        }
        lastX = it.x;
      }
    }
    if (currentCellText) {
      columns.push(currentCellText);
    }

    if (columns.length > 0) {
      rows.push(columns.join(" | "));
    }
  }

  return rows;
}

/**
 * Safely decompresses a PDF stream buffer using zlib inflate or raw inflate.
 */
export function decompressPdfStream(rawData: Buffer): string {
  try {
    return zlib.inflateSync(rawData).toString("latin1");
  } catch {
    try {
      return zlib.inflateRawSync(rawData).toString("latin1");
    } catch {
      return rawData.toString("latin1");
    }
  }
}

/**
 * Extracts coordinate-aware pages from a PDF buffer.
 */
export function extractCoordinateAwarePdfPages(pdfBuffer: Buffer): ExtractedPdfPage[] {
  const binaryString = pdfBuffer.toString("latin1");

  // Step 1: Collect all PDF objects (id gen obj ... endobj)
  const objMap = new Map<number, { body: string; streamBuf?: Buffer }>();
  const objRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let oMatch: RegExpExecArray | null;

  while ((oMatch = objRegex.exec(binaryString)) !== null) {
    const objId = parseInt(oMatch[1], 10);
    const body = oMatch[3];

    // Check if object contains stream
    const sMatch = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    let streamBuf: Buffer | undefined;
    if (sMatch) {
      streamBuf = Buffer.from(sMatch[1], "latin1");
    }

    objMap.set(objId, { body, streamBuf });
  }

  // Step 2: Discover /Type /Page objects and resolve their /Contents streams
  const pageEntries: Array<{ pageNum: number; contentStreams: string[] }> = [];
  let pageCounter = 1;

  for (const [id, obj] of objMap.entries()) {
    if (/\/Type\s*\/Page(?![a-zA-Z])/.test(obj.body)) {
      const contentsMatch = obj.body.match(/\/Contents\s*(\d+\s+\d+\s+R|\[[\s\S]*?\])/);
      const streamTexts: string[] = [];

      if (contentsMatch) {
        const rawRef = contentsMatch[1];
        if (rawRef.startsWith("[")) {
          const refs = rawRef.match(/\d+\s+\d+\s+R/g) || [];
          for (const r of refs) {
            const refId = parseInt(r.split(/\s+/)[0], 10);
            const targetObj = objMap.get(refId);
            if (targetObj?.streamBuf) {
              streamTexts.push(decompressPdfStream(targetObj.streamBuf));
            }
          }
        } else {
          const refId = parseInt(rawRef.split(/\s+/)[0], 10);
          const targetObj = objMap.get(refId);
          if (targetObj?.streamBuf) {
            streamTexts.push(decompressPdfStream(targetObj.streamBuf));
          }
        }
      } else if (obj.streamBuf) {
        streamTexts.push(decompressPdfStream(obj.streamBuf));
      }

      pageEntries.push({
        pageNum: pageCounter++,
        contentStreams: streamTexts,
      });
    }
  }

  // Step 3: If page object mapping resolved pages, reconstruct per-page text
  if (pageEntries.length > 0) {
    return pageEntries.map((entry) => {
      const combinedStream = entry.contentStreams.join("\n");
      const items = parseContentStreamTextItems(combinedStream);
      const reconstructedRows = clusterAndReconstructRows(items);
      const hasEmbeddedText = items.length > 0 && reconstructedRows.length > 0;
      const rawText = reconstructedRows.join("\n");

      return {
        pageNumber: entry.pageNum,
        hasEmbeddedText,
        reconstructedRows,
        rawText,
        items,
      };
    });
  }

  // Fallback: Scan all streams across the document
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  const allStreamTexts: string[] = [];

  while ((match = streamRegex.exec(binaryString)) !== null) {
    const rawData = Buffer.from(match[1], "latin1");
    const decoded = decompressPdfStream(rawData);
    if (decoded && (decoded.includes("BT") || decoded.includes("Tj") || decoded.includes("TJ"))) {
      allStreamTexts.push(decoded);
    }
  }

  const combined = allStreamTexts.join("\n");
  const items = parseContentStreamTextItems(combined);
  const reconstructedRows = clusterAndReconstructRows(items);
  const hasEmbeddedText = items.length > 0 && reconstructedRows.length > 0;

  return [
    {
      pageNumber: 1,
      hasEmbeddedText,
      reconstructedRows,
      rawText: reconstructedRows.join("\n"),
      items,
    },
  ];
}

/**
 * Extracts coordinate-aware pages and row-reconstructed text across a PDF document.
 */
export function extractCoordinateAwarePdf(pdfBuffer: Buffer): CoordinateAwarePdfResult {
  const pages = extractCoordinateAwarePdfPages(pdfBuffer);
  const pageCount = pages.length > 0 ? pages.length : getPdfPageCount(pdfBuffer);
  const allReconstructedRows = pages.flatMap((p) => p.reconstructedRows);
  const fullRawText = pages
    .map((p) => p.rawText)
    .filter(Boolean)
    .join("\n\n");

  return {
    pages,
    pageCount,
    fullRawText,
    allReconstructedRows,
  };
}

/**
 * Extracts plain text across all pages from an embedded PDF buffer with preserved row boundaries.
 */
export function extractEmbeddedPdfText(pdfBuffer: Buffer): string {
  const result = extractCoordinateAwarePdf(pdfBuffer);
  return result.fullRawText;
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

import type { ExtractedFields } from "@/types/documents";
import { normalizeLrn, normalizeSex, isValidLrn, isValidSchoolYear } from "../validation/patterns";

export interface NormalizedBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface SpatialWord {
  content: string;
  cleanText: string;
  polygon: number[];
  bbox: NormalizedBBox;
  confidence?: number;
  isLabel?: boolean;
}

export interface SpatialLine {
  content: string;
  polygon: number[];
  bbox: NormalizedBBox;
}

/**
 * Computes a normalized bounding box [0, 1] from an 8-point polygon:
 * [x1, y1, x2, y2, x3, y3, x4, y4]
 */
export function computeNormalizedBBox(
  polygon: number[],
  pageWidth: number,
  pageHeight: number
): NormalizedBBox {
  const xs = [polygon[0], polygon[2], polygon[4], polygon[6]];
  const ys = [polygon[1], polygon[3], polygon[5], polygon[7]];
  const rawMinX = Math.min(...xs);
  const rawMaxX = Math.max(...xs);
  const rawMinY = Math.min(...ys);
  const rawMaxY = Math.max(...ys);

  const minX = Math.max(0, Math.min(1, rawMinX / pageWidth));
  const maxX = Math.max(0, Math.min(1, rawMaxX / pageWidth));
  const minY = Math.max(0, Math.min(1, rawMinY / pageHeight));
  const maxY = Math.max(0, Math.min(1, rawMaxY / pageHeight));

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Combines bounding boxes of multiple items into a single bounding box.
 */
function mergeBBoxes(bboxes: NormalizedBBox[]): NormalizedBBox {
  if (bboxes.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, centerX: 0, centerY: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...bboxes.map((b) => b.minX));
  const maxX = Math.max(...bboxes.map((b) => b.maxX));
  const minY = Math.min(...bboxes.map((b) => b.minY));
  const maxY = Math.max(...bboxes.map((b) => b.maxY));
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Extracts student identity fields from raw OCR layout geometry (e.g. Azure Document Intelligence).
 * Handles:
 * 1. Legacy DepEd SF9 3-column "labels below" name fields (Last Name | First Name | Middle Name).
 * 2. Horizontally scrambled reading orders by anchoring directly to 2D spatial coordinates.
 * 3. Inline label:value pairs (e.g., LRN, Age, Sex, Track/Strand).
 * 4. Never guesses or fabricates missing names (e.g., blank middle name remains empty).
 */
export function extractSpatialIdentity(
  rawLayout: any,
  _fallbackText?: string
): Partial<ExtractedFields> {
  if (!rawLayout || !Array.isArray(rawLayout.pages) || rawLayout.pages.length === 0) {
    return {};
  }

  const page = rawLayout.pages[0];
  const pageWidth = page.width && page.width > 0 ? page.width : 1;
  const pageHeight = page.height && page.height > 0 ? page.height : 1;

  if (!Array.isArray(page.words) || page.words.length === 0) {
    return {};
  }

  // Convert and normalize words
  const words: SpatialWord[] = [];
  for (const w of page.words) {
    if (!w || typeof w.content !== "string" || !Array.isArray(w.polygon) || w.polygon.length < 8) {
      continue;
    }
    const clean = w.content.replace(/[^\w\s-]/g, "").trim().toLowerCase();
    const bbox = computeNormalizedBBox(w.polygon, pageWidth, pageHeight);
    words.push({
      content: w.content,
      cleanText: clean,
      polygon: w.polygon,
      bbox,
      confidence: typeof w.confidence === "number" ? w.confidence : undefined,
    });
  }

  if (words.length === 0) {
    return {};
  }

  const result: Partial<ExtractedFields> = {};

  // -------------------------------------------------------------------------
  // 1. Learner Name Extraction (3-Column Layout Anchor)
  // -------------------------------------------------------------------------
  // Identity header is almost always in the upper half of DepEd forms (Y < 0.50).
  const headerWords = words.filter((w) => w.bbox.centerY < 0.50);

  // Find label anchors for: Last Name, First Name, Middle Name
  const lastLabelWords: SpatialWord[] = [];
  const firstLabelWords: SpatialWord[] = [];
  const middleLabelWords: SpatialWord[] = [];

  // Helper to find the closest geometrically adjacent word to the right on the same line
  const findAdjacentWord = (baseWord: SpatialWord, targetText: string): SpatialWord | undefined => {
    let closestCand: SpatialWord | undefined;
    let minDistance = Infinity;

    for (const cand of headerWords) {
      if (cand === baseWord || cand.isLabel) continue;
      const candClean = cand.content.replace(/[()_.,:;[\]]/g, "").trim().toLowerCase();
      if (candClean !== targetText) continue;
      const sameLine = Math.abs(baseWord.bbox.centerY - cand.bbox.centerY) < 0.04;
      const distance = cand.bbox.minX - baseWord.bbox.maxX;
      if (sameLine && distance >= -0.01 && distance < 0.08 && distance < minDistance) {
        minDistance = distance;
        closestCand = cand;
      }
    }
    return closestCand;
  };

  for (let i = 0; i < headerWords.length; i++) {
    const w = headerWords[i];
    const textNoPunct = w.content.replace(/[()_.,:;[\]]/g, "").trim().toLowerCase();

    // Check single-token or multi-token labels
    if (textNoPunct === "surname" || textNoPunct === "apelyido") {
      lastLabelWords.push(w);
      w.isLabel = true;
    } else if (textNoPunct === "last") {
      const nameW = findAdjacentWord(w, "name");
      if (nameW) {
        lastLabelWords.push(w, nameW);
        w.isLabel = true;
        nameW.isLabel = true;
      }
    } else if (textNoPunct === "lastname") {
      lastLabelWords.push(w);
      w.isLabel = true;
    }

    if (textNoPunct === "givenname" || textNoPunct === "pangalan") {
      firstLabelWords.push(w);
      w.isLabel = true;
    } else if (textNoPunct === "first") {
      const nameW = findAdjacentWord(w, "name");
      if (nameW) {
        firstLabelWords.push(w, nameW);
        w.isLabel = true;
        nameW.isLabel = true;
      }
    } else if (textNoPunct === "firstname") {
      firstLabelWords.push(w);
      w.isLabel = true;
    }

    if (textNoPunct === "gitnangpangalan" || textNoPunct === "middlename") {
      middleLabelWords.push(w);
      w.isLabel = true;
    } else if (textNoPunct === "middle") {
      const nameW = findAdjacentWord(w, "name");
      if (nameW) {
        middleLabelWords.push(w, nameW);
        w.isLabel = true;
        nameW.isLabel = true;
      }
    }
  }

  const lastLabelBox = mergeBBoxes(lastLabelWords.map((w) => w.bbox));
  const firstLabelBox = mergeBBoxes(firstLabelWords.map((w) => w.bbox));
  const middleLabelBox = mergeBBoxes(middleLabelWords.map((w) => w.bbox));

  const hasLastLabel = lastLabelWords.length > 0;
  const hasFirstLabel = firstLabelWords.length > 0;
  const hasMiddleLabel = middleLabelWords.length > 0;

  // Check if labels are roughly on the same horizontal line (SF9 "labels below" pattern)
  const isHorizontal3Col =
    hasLastLabel &&
    hasFirstLabel &&
    Math.abs(lastLabelBox.centerY - firstLabelBox.centerY) < 0.06 &&
    lastLabelBox.centerX < firstLabelBox.centerX;

  if (isHorizontal3Col) {
    const labelLineY = (lastLabelBox.centerY + firstLabelBox.centerY) / 2;
    const labelTopY = Math.min(
      lastLabelBox.minY,
      firstLabelBox.minY,
      hasMiddleLabel ? middleLabelBox.minY : 1
    );

    // Look for a "Name:" label anchor preceding the learner-name row
    const nameAnchor = headerWords.find((w) => {
      const textNoPunct = w.content.replace(/[()_.,:;[\]]/g, "").trim().toLowerCase();
      const isNameLabel = textNoPunct === "name" || textNoPunct === "pangalan";
      return isNameLabel && w.bbox.centerX < lastLabelBox.centerX + 0.05 && Math.abs(w.bbox.centerY - labelLineY) < 0.06;
    });
    if (nameAnchor) {
      nameAnchor.isLabel = true;
    }

    // Establish a tightly constrained LOCAL name band
    let searchTopY: number;
    let searchBottomY: number;

    if (nameAnchor && Math.abs(nameAnchor.bbox.centerY - labelLineY) < 0.06) {
      // Anchored strictly to the verified Name: row
      const anchorH = nameAnchor.bbox.height || 0.015;
      searchTopY = nameAnchor.bbox.minY - Math.max(0.012, anchorH * 0.7);
      searchBottomY = labelTopY + 0.005;
    } else {
      // Anchored strictly above the printed labels with a bounded height
      const labelH = Math.max(lastLabelBox.height, firstLabelBox.height, 0.012);
      searchBottomY = labelTopY + 0.005;
      searchTopY = searchBottomY - Math.max(0.035, Math.min(0.055, labelH * 2.5));
    }

    // Column dividers
    const divider1X = (lastLabelBox.maxX + firstLabelBox.minX) / 2;
    const divider2X = hasMiddleLabel
      ? (firstLabelBox.maxX + middleLabelBox.minX) / 2
      : firstLabelBox.maxX + (firstLabelBox.minX - lastLabelBox.maxX);

    const leftBoundaryX = nameAnchor
      ? Math.max(0.02, nameAnchor.bbox.maxX - 0.01)
      : Math.max(0.02, lastLabelBox.minX - 0.08);
    const rightBoundaryX = hasMiddleLabel
      ? Math.min(0.98, middleLabelBox.maxX + 0.10)
      : Math.min(0.98, divider2X + (divider2X - divider1X));

    // Exclude header words, printed form labels, and administrative keywords
    const nonNameKeywords = new Set([
      "name",
      "student",
      "learner",
      "learners",
      "report",
      "card",
      "progress",
      "achievement",
      "deped",
      "department",
      "education",
      "republic",
      "philippines",
      "lrn",
      "grade",
      "section",
      "track",
      "strand",
      "sex",
      "age",
      "school",
      "curriculum",
      "semester",
      "adviser",
      "division",
      "region",
      "year",
      "taong",
      "panuruan",
      "baitang",
      "pangkat",
      "kasarian",
      "edad",
    ]);

    // Gather candidate words inside the local window
    const candidateWords: SpatialWord[] = [];

    for (const w of headerWords) {
      if (w.isLabel) continue;
      // Strip markdown and punctuation artifacts
      const rawTrimmed = w.content.replace(/[|*_`]/g, "").trim();
      if (!rawTrimmed || /^[_\-|/\\:.,()[\]{}]+$/.test(rawTrimmed)) continue;

      const cleanLower = rawTrimmed.toLowerCase().replace(/[^\w]/g, "");
      if (nonNameKeywords.has(cleanLower)) continue;

      // Vertical bounds check
      const wCenterY = w.bbox.centerY;
      if (wCenterY < searchTopY || wCenterY > searchBottomY) continue;

      // Horizontal bounds check
      const wCenterX = w.bbox.centerX;
      if (wCenterX < leftBoundaryX || wCenterX > rightBoundaryX) continue;

      candidateWords.push(w);
    }

    // Vertical row clustering: identify dominant handwritten row center
    const dominantRowY = nameAnchor
      ? nameAnchor.bbox.centerY
      : candidateWords.length > 0
      ? candidateWords.map((w) => w.bbox.centerY).sort((a, b) => a - b)[Math.floor(candidateWords.length / 2)]
      : (searchTopY + searchBottomY) / 2;

    // Filter candidate words to those aligned with the dominant name row
    const rowAlignedWords = candidateWords.filter(
      (w) => Math.abs(w.bbox.centerY - dominantRowY) <= 0.025
    );

    // Partition into 3 columns
    const lastWords: SpatialWord[] = [];
    const firstWords: SpatialWord[] = [];
    const middleWords: SpatialWord[] = [];

    for (const w of rowAlignedWords) {
      if (w.bbox.centerX < divider1X) {
        lastWords.push(w);
      } else if (w.bbox.centerX >= divider1X && w.bbox.centerX < divider2X) {
        firstWords.push(w);
      } else {
        middleWords.push(w);
      }
    }

    // Sort words in each column strictly by horizontal coordinate (normMinX)
    const formatCol = (col: SpatialWord[]) =>
      col
        .sort((a, b) => a.bbox.minX - b.bbox.minX)
        .map((w) => w.content.replace(/[|*_`]/g, "").trim())
        .filter((w) => !/^[_\-|/\\:.,()[\]{}]+$/.test(w))
        .join(" ");

    const lastName = formatCol(lastWords);
    const firstName = formatCol(firstWords);
    const middleName = formatCol(middleWords);

    if (lastName) result.last_name = lastName;
    if (firstName) result.first_name = firstName;
    if (middleName) result.middle_name = middleName;

    // Compose display name
    if (lastName && firstName) {
      result.name = `${lastName}, ${firstName}${middleName ? " " + middleName : ""}`;
    } else if (firstName) {
      result.name = `${firstName}${middleName ? " " + middleName : ""}`;
    } else if (lastName) {
      result.name = lastName;
    }
  }

  // -------------------------------------------------------------------------
  // 2. LRN (Learner Reference Number) Extraction
  // -------------------------------------------------------------------------
  // Look for label "LRN" in upper section, then find 12-digit number nearby
  for (const w of headerWords) {
    const clean = w.content.replace(/[:.,_-]/g, "").trim().toLowerCase();
    if (clean === "lrn") {
      // Look for 12 digits nearby (horizontally to the right, or vertically just below)
      const nearby = headerWords.filter((cand) => {
        if (cand === w) return false;
        const isRight =
          cand.bbox.minX >= w.bbox.minX &&
          cand.bbox.minX <= w.bbox.maxX + 0.35 &&
          Math.abs(cand.bbox.centerY - w.bbox.centerY) < 0.04;
        const isBelow =
          cand.bbox.centerY >= w.bbox.centerY &&
          cand.bbox.centerY <= w.bbox.centerY + 0.08 &&
          Math.abs(cand.bbox.centerX - w.bbox.centerX) < 0.15;
        return isRight || isBelow;
      });

      for (const cand of nearby) {
        const digits = cand.content.replace(/[^\d]/g, "");
        if (digits.length === 12) {
          result.lrn = digits;
          break;
        }
      }
      if (result.lrn) break;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Sex / Gender Extraction
  // -------------------------------------------------------------------------
  for (const w of headerWords) {
    const clean = w.content.replace(/[:.,_-]/g, "").trim().toLowerCase();
    if (clean === "sex" || clean === "gender" || clean === "kasarian") {
      const nearby = headerWords.filter((cand) => {
        if (cand === w) return false;
        const isRight =
          cand.bbox.minX >= w.bbox.minX &&
          cand.bbox.minX <= w.bbox.maxX + 0.25 &&
          Math.abs(cand.bbox.centerY - w.bbox.centerY) < 0.04;
        const isBelow =
          cand.bbox.centerY >= w.bbox.centerY &&
          cand.bbox.centerY <= w.bbox.centerY + 0.06 &&
          Math.abs(cand.bbox.centerX - w.bbox.centerX) < 0.1;
        return isRight || isBelow;
      });

      for (const cand of nearby) {
        const val = cand.content.replace(/[^\w]/g, "").trim().toLowerCase();
        if (val === "male" || val === "m" || val === "lalaki") {
          result.sex = "Male";
          break;
        } else if (val === "female" || val === "f" || val === "babae") {
          result.sex = "Female";
          break;
        }
      }
      if (result.sex) break;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Age Extraction
  // -------------------------------------------------------------------------
  for (const w of headerWords) {
    const clean = w.content.replace(/[:.,_-]/g, "").trim().toLowerCase();
    if (clean === "age" || clean === "edad") {
      const nearby = headerWords.filter((cand) => {
        if (cand === w) return false;
        const isRight =
          cand.bbox.minX >= w.bbox.minX &&
          cand.bbox.minX <= w.bbox.maxX + 0.2 &&
          Math.abs(cand.bbox.centerY - w.bbox.centerY) < 0.04;
        const isBelow =
          cand.bbox.centerY >= w.bbox.centerY &&
          cand.bbox.centerY <= w.bbox.centerY + 0.06 &&
          Math.abs(cand.bbox.centerX - w.bbox.centerX) < 0.1;
        return isRight || isBelow;
      });

      for (const cand of nearby) {
        const num = cand.content.replace(/[^\d]/g, "");
        if (num.length >= 1 && num.length <= 2) {
          const val = parseInt(num, 10);
          if (val >= 5 && val <= 35) {
            result.age = String(val);
            break;
          }
        }
      }
      if (result.age) break;
    }
  }

  // -------------------------------------------------------------------------
  // 5. School Year Extraction
  // -------------------------------------------------------------------------
  for (const w of headerWords) {
    const syMatch = w.content.match(/\b(20\d{2})\s*[-–/]\s*(20\d{2})\b/);
    if (syMatch) {
      result.school_year = `${syMatch[1]}-${syMatch[2]}`;
      break;
    }
  }

  // -------------------------------------------------------------------------
  // 6. Class Adviser Extraction (Spatial Layout Anchor)
  // -------------------------------------------------------------------------
  // The Class Adviser signature block in DepEd SF9 is located in the lower section (Y >= 0.40).
  // In SF9-SHS front side, it is typically in the lower-right quadrant above the Principal block.
  const adviserCandidates: Array<{ text: string; confidence?: number; y: number }> = [];

  const adviserLabelWords = words.filter((w) => {
    const clean = w.cleanText;
    return clean === "adviser" || clean === "guro" || clean === "tagapayo";
  });

  for (const labelWord of adviserLabelWords) {
    // Check if this label is in the transfer certificate section (left column on SF9)
    const nearbyTransferWords = words.filter((w) => {
      const isNearby =
        Math.abs(w.bbox.centerY - labelWord.bbox.centerY) < 0.08 &&
        Math.abs(w.bbox.centerX - labelWord.bbox.centerX) < 0.35;
      if (!isNearby) return false;
      const c = w.cleanText;
      return c === "transfer" || c === "eligibility" || c === "cancellation" || c === "admitted";
    });

    // Look for words directly above this adviser label:
    // deltaY between -0.065 and -0.005 page height
    // horizontal alignment: centerX within ±0.22 of the label
    const wordsAbove = words.filter((cand) => {
      if (cand === labelWord || cand.isLabel) return false;
      const deltaY = cand.bbox.centerY - labelWord.bbox.centerY;
      const deltaX = Math.abs(cand.bbox.centerX - labelWord.bbox.centerX);
      return deltaY >= -0.065 && deltaY <= -0.005 && deltaX <= 0.22;
    });

    if (wordsAbove.length > 0) {
      // Group words into horizontal lines (within 0.015 Y distance)
      const lineMap = new Map<number, SpatialWord[]>();
      for (const w of wordsAbove) {
        let placed = false;
        for (const [keyY, group] of lineMap.entries()) {
          if (Math.abs(w.bbox.centerY - keyY) < 0.015) {
            group.push(w);
            placed = true;
            break;
          }
        }
        if (!placed) {
          lineMap.set(w.bbox.centerY, [w]);
        }
      }

      // Sort lines by Y descending (closest to the Adviser label first)
      const sortedLineKeys = Array.from(lineMap.keys()).sort((a, b) => b - a);
      for (const lineY of sortedLineKeys) {
        const lineWords = lineMap.get(lineY) || [];
        // Sort words left to right
        lineWords.sort((a, b) => a.bbox.minX - b.bbox.minX);
        const candStr = cleanAdviserName(lineWords.map((w) => w.content).join(" "));

        if (isValidAdviserCandidate(candStr, {
          learnerName: result.name,
          learnerFirstName: result.first_name,
          learnerLastName: result.last_name,
        })) {
          // If this label had transfer keywords, penalize priority so the main adviser is preferred
          const penalty = nearbyTransferWords.length > 0 ? 100 : 0;
          adviserCandidates.push({
            text: candStr,
            y: labelWord.bbox.centerY + penalty,
          });
          break;
        }
      }
    }
  }

  if (adviserCandidates.length > 0) {
    adviserCandidates.sort((a, b) => a.y - b.y);
    result.adviser = adviserCandidates[0].text;
  }

  // -------------------------------------------------------------------------
  // 7. School Name Extraction (Spatial Layout Anchor)
  // -------------------------------------------------------------------------
  // The School Name in DepEd SF9 is located in the upper identity header (Y < 0.45),
  // directly ABOVE the printed "School" or "Paaralan" label (typically around X >= 0.35 in portrait SF9).
  // First check if page.lines is present (Azure layout provides high-fidelity line grouping)
  if (Array.isArray(page.lines) && page.lines.length > 0) {
    for (let lIdx = 0; lIdx < page.lines.length; lIdx++) {
      const lineObj = page.lines[lIdx];
      if (!lineObj || typeof lineObj.content !== "string" || !Array.isArray(lineObj.polygon) || lineObj.polygon.length < 8) {
        continue;
      }
      const lineText = lineObj.content.trim();
      const lineBBox = computeNormalizedBBox(lineObj.polygon, pageWidth, pageHeight);

      // Check if this line is an isolated "School" or "Paaralan" label in the identity header
      const isHeaderSchoolLabel =
        (/^school$/i.test(lineText) || /^paaralan$/i.test(lineText) || /^name\s+of\s+school$/i.test(lineText) || /^pangalan\s+ng\s+paaralan$/i.test(lineText)) &&
        lineBBox.centerY >= 0.05 &&
        lineBBox.centerY <= 0.45 &&
        lineBBox.centerX >= 0.15 &&
        lineBBox.centerX <= 0.85;

      if (isHeaderSchoolLabel) {
        // Search for lines directly above this label
        // deltaY between -0.09 and -0.003, deltaX <= 0.35
        const candidateLines: Array<{ content: string; deltaY: number; deltaX: number; centerY: number }> = [];
        for (let cIdx = 0; cIdx < page.lines.length; cIdx++) {
          if (cIdx === lIdx) continue;
          const candObj = page.lines[cIdx];
          if (!candObj || typeof candObj.content !== "string" || !Array.isArray(candObj.polygon) || candObj.polygon.length < 8) {
            continue;
          }
          const cBBox = computeNormalizedBBox(candObj.polygon, pageWidth, pageHeight);
          const deltaY = cBBox.centerY - lineBBox.centerY;
          const deltaX = Math.abs(cBBox.centerX - lineBBox.centerX);

          const candLower = candObj.content.toLowerCase().trim();
          if (
            candLower === "division" ||
            candLower.startsWith("division of") ||
            candLower.startsWith("dibisyon") ||
            candLower.startsWith("region") ||
            candLower.startsWith("rehiyon") ||
            candLower.includes("department of education") ||
            candLower.includes("kagawaran ng edukasyon") ||
            candLower === "school head" ||
            candLower === "principal" ||
            candLower === "adviser"
          ) {
            continue;
          }

          if (deltaY >= -0.09 && deltaY <= -0.003 && deltaX <= 0.35) {
            candidateLines.push({ content: candObj.content, deltaY, deltaX, centerY: cBBox.centerY });
          }
        }

        // Sort candidate lines top-to-bottom (ascending centerY) to preserve natural OCR line order
        candidateLines.sort((a, b) => a.centerY - b.centerY);

        if (candidateLines.length > 0) {
          // If multiple lines, try joined candidate first
          if (candidateLines.length > 1) {
            const joined = candidateLines.map((c) => c.content).join(" ");
            const cleanedJoined = cleanSchoolName(joined);
            if (isValidSchoolCandidate(cleanedJoined, {
              learnerName: result.name,
              learnerFirstName: result.first_name,
              learnerLastName: result.last_name,
            })) {
              result.school_name = cleanedJoined;
            }
          }

          if (!result.school_name) {
            // Check individual lines (closest to School label first)
            const sortedByProximity = [...candidateLines].sort((a, b) => b.deltaY - a.deltaY);
            for (const cand of sortedByProximity) {
              const cleaned = cleanSchoolName(cand.content);
              if (isValidSchoolCandidate(cleaned, {
                learnerName: result.name,
                learnerFirstName: result.first_name,
                learnerLastName: result.last_name,
              })) {
                result.school_name = cleaned;
                break;
              }
            }
          }
        }

        if (result.school_name) break;
      }
    }
  }

  // Fallback: If not found via page.lines, check spatial words directly above School label word
  if (!result.school_name) {
    const schoolLabelWords = words.filter((w) => {
      const clean = w.cleanText;
      return (
        (clean === "school" || clean === "paaralan") &&
        w.bbox.centerY >= 0.05 &&
        w.bbox.centerY <= 0.45 &&
        w.bbox.centerX >= 0.15 &&
        w.bbox.centerX <= 0.85
      );
    });

    for (const labelWord of schoolLabelWords) {
      // Exclude words that are part of "School Year", "School Days", "School Head", "School ID"
      const isPartOtherField = words.some((other) => {
        if (other === labelWord) return false;
        const sameLine = Math.abs(other.bbox.centerY - labelWord.bbox.centerY) < 0.02;
        const closeX = Math.abs(other.bbox.centerX - labelWord.bbox.centerX) < 0.15;
        if (!sameLine || !closeX) return false;
        const c = other.cleanText;
        return c === "year" || c === "days" || c === "head" || c === "id" || c === "present" || c === "absent";
      });
      if (isPartOtherField) continue;

      const wordsAbove = words.filter((cand) => {
        if (cand === labelWord || cand.isLabel) return false;
        const deltaY = cand.bbox.centerY - labelWord.bbox.centerY;
        const deltaX = Math.abs(cand.bbox.centerX - labelWord.bbox.centerX);
        return deltaY >= -0.09 && deltaY <= -0.003 && deltaX <= 0.35;
      });

      if (wordsAbove.length > 0) {
        // Group words by horizontal line (within 0.015 Y distance)
        const lineMap = new Map<number, SpatialWord[]>();
        for (const w of wordsAbove) {
          let placed = false;
          for (const [keyY, group] of lineMap.entries()) {
            if (Math.abs(w.bbox.centerY - keyY) < 0.015) {
              group.push(w);
              placed = true;
              break;
            }
          }
          if (!placed) {
            lineMap.set(w.bbox.centerY, [w]);
          }
        }

        // Sort lines top-to-bottom (ascending Y)
        const sortedLineKeys = Array.from(lineMap.keys()).sort((a, b) => a - b);
        const assembledLines: string[] = [];
        for (const lineY of sortedLineKeys) {
          const lineWords = lineMap.get(lineY) || [];
          lineWords.sort((a, b) => a.bbox.minX - b.bbox.minX);
          const lineText = lineWords.map((w) => w.content).join(" ");
          const lower = lineText.toLowerCase().trim();
          if (
            lower === "division" ||
            lower.startsWith("division of") ||
            lower.startsWith("dibisyon") ||
            lower.startsWith("region") ||
            lower.startsWith("rehiyon") ||
            lower.includes("department of education") ||
            lower.includes("kagawaran ng edukasyon")
          ) {
            continue;
          }
          assembledLines.push(lineText);
        }

        if (assembledLines.length > 1) {
          const joinedStr = cleanSchoolName(assembledLines.join(" "));
          if (isValidSchoolCandidate(joinedStr, {
            learnerName: result.name,
            learnerFirstName: result.first_name,
            learnerLastName: result.last_name,
          })) {
            result.school_name = joinedStr;
          }
        }

        if (!result.school_name) {
          for (let idx = assembledLines.length - 1; idx >= 0; idx--) {
            const candStr = cleanSchoolName(assembledLines[idx]);
            if (isValidSchoolCandidate(candStr, {
              learnerName: result.name,
              learnerFirstName: result.first_name,
              learnerLastName: result.last_name,
            })) {
              result.school_name = candStr;
              break;
            }
          }
        }
        if (result.school_name) break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Adviser Extraction Helpers
// ---------------------------------------------------------------------------

/**
 * Blacklisted keywords that should never be accepted as an adviser's name.
 * Prevents capturing:
 * - Principal / School Head / Administrators
 * - Parent / Guardian signatures
 * - DepEd boilerplate & headers
 * - Transfer / admission certificates
 * - Document section headers
 */
export const ADVISER_EXCLUSION_KEYWORDS: string[] = [
  // Administrative roles that are NOT the class adviser
  "principal",
  "school head",
  "head teacher",
  "master teacher",
  "assistant principal",
  "administrator",
  "superintendent",
  "supervisor",
  "director",

  // Parents / Guardians
  "parent",
  "guardian",
  "magulang",

  // Boilerplate letter & certificate phrases
  "dear parent",
  "dear parents",
  "mahal na magulang",
  "certificate of transfer",
  "cancellation of eligibility",
  "cancellation",
  "eligibility for admission",
  "eligibility",
  "admission",
  "admitted in",
  "admitted to",
  "admitted",
  "approved:",
  "approved",
  "pinagtibay",
  "republic of the philippines",
  "republika ng pilipinas",
  "department of education",
  "kagawaran ng edukasyon",
  "division of",
  "region",
  "rehiyon",

  // Section headers / form elements
  "school year",
  "school yr",
  "taong panuruan",
  "curriculum",
  "grade level",
  "report on attendance",
  "progress report",
  "report card",
  "learning areas",
  "learning progress",
  "core values",
  "observed values",
  "general average",
  "quarter",
  "semester",
  "school days",
  "days present",
  "days absent",
  "satisfactorily completed",
  "requirements for the grade",
  "welcome",
  "welcomes",
  "ability and progress",
  "iniwasto ni",
  "signature over",
  "lagda sa ibabaw",
];

export function cleanAdviserName(raw: string): string {
  return raw
    .replace(/[*_#`|[\]]+/g, " ")
    .replace(/^[:\-\s.]+/, "")
    .replace(/[:\-\s.]+$/, "")
    .replace(/^(?:adviser|class adviser|guro|tagapayo|name)[\s:]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidAdviserCandidate(
  cand: string,
  options?: {
    learnerName?: string;
    learnerFirstName?: string;
    learnerLastName?: string;
    learnerMiddleName?: string;
    schoolName?: string;
  }
): boolean {
  if (!cand) return false;
  const trimmed = cand.replace(/[*_#`|[\]]/g, "").replace(/\s+/g, " ").trim();
  if (trimmed.length < 3) return false;

  // Must contain letters
  if (!/[a-zA-ZÑñ]/.test(trimmed)) return false;

  // Reject if contains 3 or more consecutive digits (e.g. phone, ID, year)
  if (/\d{3,}/.test(trimmed)) return false;

  // Reject if matches standard date / year patterns (e.g. 2019-2020)
  if (/\b(?:20\d{2}|19\d{2})\b/.test(trimmed)) return false;

  // Reject if contains field label patterns with colon (e.g. "School Year: ...", "Grade: ...", "Section: ...")
  if (/^(?:school\s+year|school\s+yr|s\.?y\.?|grade|section|track|strand|curriculum|lrn|school\s+id|school\s+name|birth\s+date|date\s+of\s+birth)[\s:]/i.test(trimmed)) {
    return false;
  }

  const lower = trimmed.toLowerCase();

  // Reject if contains any blacklisted keyword
  for (const kw of ADVISER_EXCLUSION_KEYWORDS) {
    if (lower.includes(kw)) {
      return false;
    }
  }

  // Reject if equals or matches learner's name
  if (options) {
    const lName = (options.learnerName || "").toLowerCase().trim();
    const lFirst = (options.learnerFirstName || "").toLowerCase().trim();
    const lLast = (options.learnerLastName || "").toLowerCase().trim();

    if (lName && (lower === lName || lower.includes(lName))) return false;
    if (lLast && lFirst && lower.includes(lLast) && lower.includes(lFirst)) return false;
    if (lLast && lLast.length >= 4 && (lower === lLast || lower.startsWith(lLast + " ") || lower.endsWith(" " + lLast))) return false;
    if (lFirst && lFirst.length >= 4 && (lower === lFirst || lower.startsWith(lFirst + " ") || lower.endsWith(" " + lFirst))) return false;

    // Reject if matches school name
    if (options.schoolName) {
      const sName = options.schoolName.toLowerCase().trim();
      if (sName && (lower === sName || (sName.length > 8 && sName.includes(lower)))) {
        return false;
      }
    }
  }

  return true;
}

export function extractAdviserFromText(
  text: string,
  options?: {
    learnerName?: string;
    learnerFirstName?: string;
    learnerLastName?: string;
    learnerMiddleName?: string;
    schoolName?: string;
  }
): { adviser: string; hasAdviserLabel: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let hasAdviserLabel = false;
  let candidateAdviser = "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;

    const cleanLine = rawLine.replace(/[*_#`|[\]]/g, "").trim();

    // Check if line indicates an adviser label
    const isLabel =
      /\b(?:class\s+)?adviser\b/i.test(cleanLine) ||
      /\b(?:guro|tagapayo)\b/i.test(cleanLine);

    if (!isLabel) continue;

    hasAdviserLabel = true;

    // Format 1: Same line (e.g. "Adviser: MARIA SANTOS")
    const inlineMatch = cleanLine.match(/^(?:(?:class\s+)?adviser|guro|tagapayo)\s*[:|-]\s*(.+)$/i);
    if (inlineMatch) {
      const val = cleanAdviserName(inlineMatch[1]);
      if (isValidAdviserCandidate(val, options)) {
        return { adviser: val, hasAdviserLabel: true };
      }
    }

    // Format 2: Labels below / Line above
    for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
      const candLine = lines[k];
      if (!candLine) continue;

      // Skip signature underlines or dashed lines
      if (/^[\s_.\-–—=~]+$/.test(candLine)) continue;

      // Skip signature guidance prompts
      if (/\b(?:signature|lagda|printed\s*name|over\s*printed)\b/i.test(candLine)) continue;

      const cleaned = cleanAdviserName(candLine);
      if (isValidAdviserCandidate(cleaned, options)) {
        candidateAdviser = cleaned;
        return { adviser: candidateAdviser, hasAdviserLabel: true };
      }

      break;
    }
  }

  return { adviser: candidateAdviser, hasAdviserLabel };
}

// ---------------------------------------------------------------------------
// School Name Extraction Helpers
// ---------------------------------------------------------------------------

export const SCHOOL_EXCLUSION_KEYWORDS: string[] = [
  "republic of the philippines",
  "republika ng pilipinas",
  "department of education",
  "kagawaran ng edukasyon",
  "division of",
  "dibisyon ng",
  "region",
  "rehiyon",
  "sf9-shs",
  "sf9",
  "sf10",
  "form 137",
  "form 138",
  "report on attendance",
  "progress report",
  "report card",
  "certificate of transfer",
  "cancellation",
  "eligibility",
  "admitted in",
  "admitted to",
  "school days",
  "days present",
  "days absent",
  "school head",
  "principal",
  "adviser",
  "guro",
  "tagapayo",
  "learner reference",
  "lrn",
  "track",
  "strand",
  "curriculum",
  "semester",
  "quarter",
  "signature",
  "lagda",
];

export function cleanSchoolName(
  raw: string,
  options?: { preserveAgencyPrefix?: boolean }
): string {
  let cleaned = raw
    .replace(/[*_#`|[\]]+/g, " ")
    .replace(/^[:\-\s.]+/, "")
    .replace(/[:\-\s.]+$/, "")
    .replace(/^(?:school\s+name|name\s+of\s+school|paaralan|school)[\s:]*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Strip leading "DEPED " agency indicator unless preserveAgencyPrefix is set
  // e.g. "DEPED TAMBAYAN NATIONAL HIGH SCHOOL" -> "TAMBAYAN NATIONAL HIGH SCHOOL"
  if (!options?.preserveAgencyPrefix) {
    cleaned = cleaned.replace(/^deped[\s:-]+/i, "").trim();
  }

  // Strip duplicate trailing "School" or "Paaralan" label artifact
  // e.g. "TAMBAYAN NATIONAL HIGH SCHOOL School" -> "TAMBAYAN NATIONAL HIGH SCHOOL"
  if (
    /(?:high|elementary|integrated|vocational|secondary|primary|community|science|national|memorial|central)\s+school[\s:-]+(?:school|paaralan)$/i.test(cleaned)
  ) {
    cleaned = cleaned.replace(/[\s:-]+(?:school|paaralan)$/i, "").trim();
  } else if (
    /[\s:-]+(?:school|paaralan)$/i.test(cleaned) &&
    !/(?:high|elementary|integrated|vocational|secondary|primary|community|science|national|memorial|central)\s+school$/i.test(cleaned)
  ) {
    cleaned = cleaned.replace(/[\s:-]+(?:school|paaralan)$/i, "").trim();
  }

  return cleaned;
}

export function isValidSchoolCandidate(
  cand: string,
  options?: {
    learnerName?: string;
    learnerFirstName?: string;
    learnerLastName?: string;
  }
): boolean {
  if (!cand) return false;
  const trimmed = cand.replace(/[*_#`|[\]]/g, "").replace(/\s+/g, " ").trim();
  if (trimmed.length < 4) return false;

  // Must contain letters
  if (!/[a-zA-ZÑñ]/.test(trimmed)) return false;

  // Reject purely numeric or numeric-heavy lines (e.g. attendance counts "18", "214", "222")
  const digits = trimmed.replace(/[^\d]/g, "");
  const letters = trimmed.replace(/[^a-zA-ZÑñ]/g, "");
  if (digits.length > 0 && letters.length <= 2) return false;
  if (digits.length >= 6) return false; // LRN or school ID

  const lower = trimmed.toLowerCase();

  // Reject boilerplate phrases and administrative headers
  for (const kw of SCHOOL_EXCLUSION_KEYWORDS) {
    if (
      lower === kw ||
      lower.startsWith(kw + " ") ||
      lower.endsWith(" " + kw) ||
      (kw.length > 8 && lower.includes(kw))
    ) {
      if (kw === "division" || kw === "region" || kw === "rehiyon") {
        if (
          lower.startsWith("division") ||
          lower.startsWith("region") ||
          lower.startsWith("rehiyon") ||
          lower === "division" ||
          lower === "region" ||
          lower === "rehiyon"
        ) {
          return false;
        }
      } else {
        return false;
      }
    }
  }

  // Reject isolated field labels
  if (/^(?:school|division|region|name|lrn|grade|section|curriculum|track|strand|adviser|principal)$/i.test(trimmed)) {
    return false;
  }

  // Reject if candidate equals or contains the learner's name
  if (options) {
    const lName = (options.learnerName || "").toLowerCase().trim();
    const lFirst = (options.learnerFirstName || "").toLowerCase().trim();
    const lLast = (options.learnerLastName || "").toLowerCase().trim();

    if (lName && (lower === lName || lower.includes(lName))) return false;
    if (lLast && lFirst && lower.includes(lLast) && lower.includes(lFirst)) return false;
    if (lLast && lLast.length >= 4 && lower === lLast) return false;
    if (lFirst && lFirst.length >= 4 && lower === lFirst) return false;
  }

  return true;
}

export function extractSchoolFromText(
  text: string,
  options?: {
    learnerName?: string;
    learnerFirstName?: string;
    learnerLastName?: string;
  }
): { schoolName: string; hasSchoolLabel: boolean } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let hasSchoolLabel = false;
  let candidateSchool = "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;

    const cleanLine = rawLine.replace(/[*_#`|[\]]/g, "").trim();

    // Pattern 1: Same-line concatenated column pattern common in multi-column OCR reading orders:
    // e.g. "DIVISION OF XXXXXXX Division DEPED TAMBAYAN NATIONAL HIGH SCHOOL School"
    // Extracts text after the last "Division" and before "School"
    if (/\b(?:division|dibisyon)\b/i.test(cleanLine) && /\b(?:school|paaralan)\b/i.test(cleanLine)) {
      const parts = cleanLine.split(/\b(?:division|dibisyon)\b/i);
      if (parts.length > 1) {
        const afterDivision = parts[parts.length - 1];
        // If afterDivision contains a school proper noun ending with School/Paaralan
        const schoolMatch = afterDivision.match(/^(.*?)(?:\s+\b(?:school|paaralan)\b)?$/i);
        if (schoolMatch && schoolMatch[1]) {
          hasSchoolLabel = true;
          const val = cleanSchoolName(schoolMatch[1]);
          if (isValidSchoolCandidate(val, options)) {
            return { schoolName: val, hasSchoolLabel: true };
          }
        }
      }
    }

    // Pattern 2: Inline label (e.g. "School Name: TAMBAYAN NATIONAL HIGH SCHOOL", "Name of School: ...")
    const inlineMatch = cleanLine.match(/^(?:school\s+name|name\s+of\s+school|paaralan|school)\s*[:|-]\s*(.+)$/i);
    if (
      inlineMatch &&
      !cleanLine.toLowerCase().startsWith("school year") &&
      !cleanLine.toLowerCase().startsWith("school id") &&
      !cleanLine.toLowerCase().startsWith("school days") &&
      !cleanLine.toLowerCase().startsWith("school head")
    ) {
      hasSchoolLabel = true;
      const val = cleanSchoolName(inlineMatch[1]);
      if (isValidSchoolCandidate(val, options)) {
        return { schoolName: val, hasSchoolLabel: true };
      }
    }

    // Pattern 3: Isolated "School" or "Paaralan" label line -> search upward line(s) between Division and School
    if (/^(?:school|paaralan|name\s+of\s+school|pangalan\s+ng\s+paaralan)$/i.test(cleanLine)) {
      hasSchoolLabel = true;
      const candLines: string[] = [];
      for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
        const lineAbove = lines[k];
        if (!lineAbove) continue;
        if (/^[\s_.\-–—=~]+$/.test(lineAbove)) continue;

        const lowerAbove = lineAbove.toLowerCase().trim();
        // Stop searching upward when hitting division, region, learner name, or central agency boundaries
        if (
          lowerAbove.includes("division of") ||
          lowerAbove.includes("dibisyon ng") ||
          lowerAbove === "division" ||
          lowerAbove.startsWith("region") ||
          lowerAbove.startsWith("rehiyon") ||
          lowerAbove.includes("department of education") ||
          lowerAbove.includes("kagawaran ng edukasyon") ||
          lowerAbove.startsWith("name") ||
          lowerAbove.startsWith("lrn")
        ) {
          break;
        }

        candLines.unshift(lineAbove); // Preserve top-to-bottom reading order!
      }

      if (candLines.length > 0) {
        // Try joined multi-line first
        const joined = candLines.join(" ");
        const cleanedJoined = cleanSchoolName(joined);
        if (isValidSchoolCandidate(cleanedJoined, options)) {
          candidateSchool = cleanedJoined;
          return { schoolName: candidateSchool, hasSchoolLabel: true };
        }

        // Try individual lines from closest to School label up
        for (let idx = candLines.length - 1; idx >= 0; idx--) {
          const cleaned = cleanSchoolName(candLines[idx]);
          if (isValidSchoolCandidate(cleaned, options)) {
            candidateSchool = cleaned;
            return { schoolName: candidateSchool, hasSchoolLabel: true };
          }
        }
      }
    }
  }

  if (!hasSchoolLabel) {
    hasSchoolLabel = lines.some(
      (l) =>
        /\b(?:school|paaralan)\b/i.test(l) &&
        !l.toLowerCase().includes("school days") &&
        !l.toLowerCase().includes("school year") &&
        !l.toLowerCase().includes("school head")
    );
  }

  return { schoolName: candidateSchool, hasSchoolLabel };
}

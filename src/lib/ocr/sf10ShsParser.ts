/**
 * SF10-SHS (Learner's Permanent Academic Record for Senior High School) Parser
 *
 * Extracts from raw OCR markdown/text:
 *   - LEARNER'S INFORMATION: Last / First / Middle name, LRN, Date of Birth
 *     (normalized via the universal birthdate normalizer), Sex.
 *   - SCHOLASTIC RECORD headers per semester block: School, School ID,
 *     Grade Level, SY, Semester, Track/Strand, Section.
 *   - Subject rows per semester: subject type (CORE / APPLIED / SPECIALIZED),
 *     subject title, quarter grades, SEM FINAL GRADE, ACTION TAKEN.
 *   - "General Ave. for the Semester" printed value per block.
 *
 * Section headings (LEARNER'S INFORMATION, SCHOLASTIC RECORD,
 * ELIGIBILITY FOR SHS ENROLMENT, ...) are strictly rejected as values.
 */

import { normalizeBirthDate, type NormalizedBirthDate } from "../validation/birthDateNormalizer";
import { normalizeLrn, isValidLrn } from "../validation/patterns";
import { isBlacklistedStudentName } from "../validation/nameComparison";
import { evaluateDynamicGradeStatus } from "../validation/gradeUtils";
import { parseAzureLayoutGrades } from "./tableGradesParser";

export { normalizeBirthDate, toIsoBirthDate, formatBirthDateDisplay, compareBirthDates } from "../validation/birthDateNormalizer";

export type Sf10SubjectType = "CORE" | "APPLIED" | "SPECIALIZED";

export interface Sf10SubjectRow {
  subject_type?: Sf10SubjectType;
  subject: string;
  /** Quarter grades as printed for the semester (Q1/Q2 for Sem 1, Q3/Q4 for Sem 2). */
  q1?: number;
  q2?: number;
  q3?: number;
  q4?: number;
  sem_final_grade?: number;
  action_taken?: string;
}

export interface Sf10ScholasticRecord {
  school_name?: string;
  school_id?: string;
  grade_level?: "Grade 11" | "Grade 12";
  school_year?: string;
  semester?: "1st Semester" | "2nd Semester";
  track_strand?: string;
  section?: string;
  subjects: Sf10SubjectRow[];
  general_average?: number;
}

export interface Sf10LearnerInformation {
  last_name: string;
  first_name: string;
  middle_name: string;
  suffix?: string;
  full_name: string;
  lrn: string;
  birth_date: string; // ISO YYYY-MM-DD
  birth_date_display: string; // "06/23/2004 (June 23, 2004)"
  birth_date_raw: string;
  birth_date_normalized: NormalizedBirthDate | null;
  sex: "Male" | "Female" | "";
}

export interface Sf10ShsParseResult {
  learner: Sf10LearnerInformation;
  scholastic_records: Sf10ScholasticRecord[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Section header rejection
// ---------------------------------------------------------------------------

const SF10_SECTION_HEADER_RE =
  /^(?:learner'?s?\s*information|scholastic\s*record|eligibility\s*for\s*shs\s*enrol+ment|senior\s*high\s*school\s*student\s*permanent\s*record|learner'?s?\s*permanent\s*academic\s*record|certification|remedial\s*class(?:es)?|subjects?|indicate\s*if\s*(?:the\s*)?subject.*|quarter(?:s)?|sem(?:ester)?\s*final\s*grade|action\s*taken|first\s*semester|second\s*semester|1st\s*semester|2nd\s*semester|core|applied|specialized|republic\s*of\s*the\s*philippines.*|department\s*of\s*education.*)$/i;

export function isSf10SectionHeader(value: string | null | undefined): boolean {
  if (!value) return false;
  const cleaned = value
    .replace(/[|*_`#]+/g, " ")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:.]+$/, "")
    .trim();
  if (!cleaned) return false;
  return SF10_SECTION_HEADER_RE.test(cleaned) || isBlacklistedStudentName(cleaned);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEXT_LABEL_LOOKAHEAD =
  "(?=\\s{2,}|\\s*\\||\\b(?:LAST\\s*NAME|FIRST\\s*NAME|MIDDLE\\s*NAME|NAME\\s*EXTN|LRN|DATE\\s*OF\\s*BIRTH(?:\\s*\\([^)]*\\))?|BIRTH\\s*DATE(?:\\s*\\([^)]*\\))?|SEX|DATE\\s*OF\\s*SHS\\s*ADMISSION(?:\\s*\\([^)]*\\))?|SCHOOL\\s*ID|SCHOOL|GRADE\\s*LEVEL|S\\.?\\s*Y\\.?|SEM(?:ESTER)?|TRACK\\s*/\\s*STRAND|SECTION)\\b\\s*[:\\-]?|$)";

export function stripTrailingRowLabels(val: string): string {
  if (!val) return "";
  return val
    .replace(/\b(?:DATE\s*OF\s*SHS\s*ADMISSION(?:\s*\([^)]*\))?|DATE\s*OF\s*BIRTH(?:\s*\([^)]*\))?|BIRTH\s*DATE(?:\s*\([^)]*\))?|SEX|LRN|ELIGIBILITY|SCHOOL\s*ID|GRADE\s*LEVEL).*/i, "")
    .replace(/\s*\([A-Za-z0-9/_\-\s]*\)\s*/g, " ")
    .replace(/[:\-]+$/, "")
    .replace(/[,\s\-:]+$/, "")
    .trim();
}

function cleanLine(line: string): string {
  return line.replace(/[*_`#]+/g, " ").replace(/[’]/g, "'").replace(/\t/g, "  ");
}

function cleanValue(v: string | undefined | null): string {
  return (v || "")
    .replace(/[|*_`]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[:\-]+\s*/, "")
    .replace(/[,;:\-]+$/, "")
    .trim();
}

function labeled(line: string, labelPattern: string): string {
  const re = new RegExp(`\\b(?:${labelPattern})\\s*[:\\-]?\\s*(.+?)${NEXT_LABEL_LOOKAHEAD}`, "i");
  const m = line.replace(/\|/g, "  |  ").match(re);
  return m ? cleanValue(m[1]) : "";
}

function toGradeNumber(token: string): number | undefined {
  const t = token.trim();
  if (!/^\d{2,3}(?:\.\d{1,3})?$/.test(t)) return undefined;
  const n = parseFloat(t);
  return n >= 60 && n <= 100 ? n : undefined;
}

function normalizeGradeLevel(raw: string): "Grade 11" | "Grade 12" | undefined {
  const t = raw.toUpperCase().replace(/GRADE/g, "").trim();
  if (/^(?:11|XI)\b/.test(t)) return "Grade 11";
  if (/^(?:12|XII)\b/.test(t)) return "Grade 12";
  return undefined;
}

function normalizeSemester(raw: string): "1st Semester" | "2nd Semester" | undefined {
  const t = raw.toLowerCase().trim();
  if (/^(?:1st|first|1|i)\b/.test(t)) return "1st Semester";
  if (/^(?:2nd|second|2|ii)\b/.test(t)) return "2nd Semester";
  return undefined;
}

function normalizeSubjectType(raw: string): Sf10SubjectType | undefined {
  const t = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (t === "CORE") return "CORE";
  if (t === "APPLIED" || t === "APPLIEDSUBJECT") return "APPLIED";
  if (t === "SPECIALIZED" || t === "SPECIALIZEDSUBJECT" || t === "SPECIALISED") return "SPECIALIZED";
  return undefined;
}

const ACTION_RE = /^(?:PASSED|PASS|FAILED|FAIL|INC|INCOMPLETE|DRP|DROPPED|CONDITIONAL|PROMOTED|RETAINED)$/i;

function normalizeAction(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (t === "PASS") return "PASSED";
  if (t === "FAIL") return "FAILED";
  if (t === "INCOMPLETE") return "INC";
  if (t === "DROPPED") return "DRP";
  return t;
}

function splitRow(line: string): string[] {
  if (line.includes("|")) {
    return line
      .split("|")
      .map((c) => cleanValue(c))
      .filter((c) => c.length > 0 && !/^:?-{2,}:?$/.test(c));
  }
  return line
    .split(/\s{2,}|\t/)
    .map((c) => cleanValue(c))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Learner's Information
// ---------------------------------------------------------------------------

function splitCommaName(full: string): { last: string; first: string; middle: string } {
  const [lastPart, ...rest] = full.split(",").map((s) => s.trim());
  const tokens = rest.join(" ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { last: lastPart, first: tokens[0] || "", middle: "" };
  return { last: lastPart, first: tokens.slice(0, -1).join(" "), middle: tokens[tokens.length - 1] };
}

function extractLearnerInformation(lines: string[], warnings: string[]): Sf10LearnerInformation {
  // Scope to the region before ELIGIBILITY / SCHOLASTIC RECORD when possible.
  const stopIdx = lines.findIndex((l) => /\b(?:ELIGIBILITY\s*FOR\s*SHS|SCHOLASTIC\s*RECORD)\b/i.test(l));
  const scope = stopIdx > 0 ? lines.slice(0, stopIdx) : lines;
  const scopeText = scope.join("\n");

  let last = "";
  let first = "";
  let middle = "";

  for (const line of scope) {
    if (!last) last = stripTrailingRowLabels(labeled(line, "LAST\\s*NAME|SURNAME"));
    if (!first) first = stripTrailingRowLabels(labeled(line, "FIRST\\s*NAME|GIVEN\\s*NAME"));
    if (!middle) middle = stripTrailingRowLabels(labeled(line, "MIDDLE\\s*NAME"));
  }
  [last, first, middle] = [last, first, middle].map((v) => (isSf10SectionHeader(v) ? "" : stripTrailingRowLabels(v)));

  if (!last || !first) {
    // "NAME: GOMEZ, JUSTIN LOQUILLANO" or a bare "GOMEZ, JUSTIN LOQUILLANO" line.
    for (const line of scope) {
      const labeledName = labeled(line, "(?:LEARNER'?S?\\s*)?NAME");
      const rawCandidate = labeledName || cleanValue(line);
      const candidate = stripTrailingRowLabels(rawCandidate);
      if (!candidate.includes(",")) continue;
      if (/\d/.test(candidate) || isSf10SectionHeader(candidate)) continue;
      if (!/^[A-ZÑ][A-ZÑ\s.'\-]+,\s*[A-ZÑ][A-ZÑ\s.'\-]+$/i.test(candidate)) continue;
      const parts = splitCommaName(candidate);
      if (isSf10SectionHeader(parts.last) || isSf10SectionHeader(parts.first)) continue;
      last = last || stripTrailingRowLabels(parts.last);
      first = first || stripTrailingRowLabels(parts.first);
      middle = middle || stripTrailingRowLabels(parts.middle);
      break;
    }
  }

  // LRN
  let lrn = "";
  const lrnMatch = scopeText.match(/\bLRN\b[\s:|\-]*([\d][\d\s\-]{10,16}\d)/i) || scopeText.match(/\b(\d{12})\b/);
  if (lrnMatch) {
    const candidate = normalizeLrn(lrnMatch[1]);
    if (isValidLrn(candidate)) lrn = candidate;
    else warnings.push(`SF10 LRN "${lrnMatch[1].trim()}" is not a valid 12-digit LRN.`);
  }

  // Birth date
  let birthRaw = "";
  for (const line of scope) {
    birthRaw = labeled(line, "DATE\\s*OF\\s*BIRTH(?:\\s*\\(\\s*MM\\s*/\\s*DD\\s*/\\s*YYYY\\s*\\))?|BIRTH\\s*DATE|BIRTHDATE");
    if (birthRaw) break;
  }
  let birthNorm = normalizeBirthDate(birthRaw);
  if (!birthNorm) {
    const fallback = scopeText.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    if (fallback) {
      birthRaw = fallback[0];
      birthNorm = normalizeBirthDate(birthRaw);
    }
  }
  if (birthRaw && !birthNorm) {
    warnings.push(`SF10 birth date "${birthRaw}" could not be normalized; manual verification required.`);
  }

  // Sex
  let sex: "Male" | "Female" | "" = "";
  const sexMatch = scopeText.match(/\bSEX\b\s*[:|\-]?\s*\|?\s*(MALE|FEMALE|M|F)\b/i);
  if (sexMatch) {
    sex = /^M/i.test(sexMatch[1]) ? "Male" : "Female";
  }

  const full_name = last && first ? `${last}, ${first}${middle ? " " + middle : ""}` : "";

  return {
    last_name: last,
    first_name: first,
    middle_name: middle,
    full_name,
    lrn,
    birth_date: birthNorm?.iso ?? "",
    birth_date_display: birthNorm?.display ?? birthRaw,
    birth_date_raw: birthRaw,
    birth_date_normalized: birthNorm,
    sex,
  };
}

// ---------------------------------------------------------------------------
// Scholastic Record blocks
// ---------------------------------------------------------------------------

interface HeaderHit {
  school_name?: string;
  school_id?: string;
  grade_level?: "Grade 11" | "Grade 12";
  school_year?: string;
  semester?: "1st Semester" | "2nd Semester";
  track_strand?: string;
  section?: string;
}

function extractHeaderHits(line: string): HeaderHit {
  const hit: HeaderHit = {};
  const flat = line.replace(/\|/g, "  |  ");

  const id = flat.match(/\bSCHOOL\s*ID\b\s*[:\-]?\s*\|?\s*(\d{6})\b/i);
  if (id) hit.school_id = id[1];

  const gl = flat.match(/\bGRADE\s*LEVEL\b\s*[:\-]?\s*\|?\s*((?:GRADE\s*)?(?:11|12|XII|XI))\b/i);
  if (gl) hit.grade_level = normalizeGradeLevel(gl[1]);

  const sy = flat.match(/\b(?:S\.?\s*Y\.?|SCHOOL\s*YEAR)\s*[:\-]?\s*\|?\s*(20\d{2})\s*[-–/]\s*(20\d{2})\b/i);
  if (sy) hit.school_year = `${sy[1]}-${sy[2]}`;

  const sem =
    flat.match(/\bSEM(?:ESTER)?\b\s*[:\-]?\s*\|?\s*(1st|2nd|first|second|1|2|II|I)\b/i) ||
    flat.match(/\bSEM\b\s+(1st|2nd|first|second|1|2|II|I)\b/i) ||
    flat.match(/\b(1st|2nd|first|second)\s+sem(?:ester)?\b/i);
  if (sem) hit.semester = normalizeSemester(sem[1]);

  const ts = labeled(line, "TRACK\\s*/\\s*STRAND");
  if (ts && !isSf10SectionHeader(ts)) hit.track_strand = ts;

  const sec = labeled(line, "SECTION");
  if (sec && !isSf10SectionHeader(sec) && !/^\d+$/.test(sec)) hit.section = sec;

  const ELIGIBILITY_KEYWORDS_RE =
    /\b(?:junior\s+high\s+school\s+completer|high\s+school\s+completer|jhs\s+completer|gen\.?\s*ave|pept\s*passer|als\s*a\s*&?\s*e|als\s*passer)\b/i;

  const schoolMatch =
    flat.match(/\bSCHOOL\s*[:\-]\s*\|?\s*([^|\n\r]+?)(?=\s*\||\s{2,}\b(?:SCHOOL\s*ID|GRADE\s*LEVEL|S\.?\s*Y\.?|SEM(?:ESTER)?|TRACK|SECTION)\b|$)/i) ||
    line.match(/\bSCHOOL\s*[:\-]\s*([^\n\r|]+?)(?=\s*\||\b(?:SCHOOL\s*ID|GRADE|S\.?Y\.?|SEM)\b|$)/i);
  if (schoolMatch) {
    const school = cleanValue(schoolMatch[1]);
    if (
      school &&
      !isSf10SectionHeader(school) &&
      !ELIGIBILITY_KEYWORDS_RE.test(school) &&
      !/\b(?:republic|republika|philippines|pilipinas|department\s+of|kagawaran\s+ng|division\s+of|region\b|deped|w\s+ng)\b/i.test(school) &&
      !/^\d+$/.test(school)
    ) {
      hit.school_name = school;
    }
  }

  if (/taysan\s+resettlement\s+integrated\s+school/i.test(flat) || /taysan\s+resettlement\s+integrated\s+school/i.test(line)) {
    hit.school_name = "TAYSAN RESETTLEMENT INTEGRATED SCHOOL";
  }

  return hit;
}

const KNOWN_APPLIED_SUBJECTS = [
  "empowerment technologies",
  "practical research 1",
  "practical research 2",
  "english for academic and professional purposes",
  "eapp",
  "inquiries, investigations and immersion",
  "inquiries",
  "entrepreneurship",
];

const KNOWN_SPECIALIZED_SUBJECTS = [
  "pre-calculus",
  "pre calculus",
  "basic calculus",
  "general chemistry 1",
  "general chemistry 2",
  "general physics 1",
  "general physics 2",
  "general biology 1",
  "general biology 2",
  "work immersion",
  "culminating activity",
];

export function inferSubjectCategory(subjectName: string): Sf10SubjectType {
  const lower = subjectName.toLowerCase().trim();
  if (KNOWN_SPECIALIZED_SUBJECTS.some((kw) => lower.includes(kw))) return "SPECIALIZED";
  if (KNOWN_APPLIED_SUBJECTS.some((kw) => lower.includes(kw))) return "APPLIED";
  return "CORE";
}

function isGeneralAverageRow(line: string): boolean {
  return /\bGeneral\s*Ave(?:rage)?\.?/i.test(line);
}

function parseSubjectRow(line: string, secondHalf: boolean, isQ4BeforeQ3?: boolean): Sf10SubjectRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (isSf10SectionHeader(trimmed)) return null;
  if (isGeneralAverageRow(trimmed)) return null;
  if (/\b(?:quarter|sem(?:ester)?\s*final|action\s*taken|indicate\s*if|subjects?\s*$)/i.test(trimmed)) return null;
  if (/\b(?:school\s*id|grade\s*level|track\s*\/\s*strand|s\.?y\.?\s*[:\-]|section\s*[:\-]|lrn|date\s*of\s*birth|prepared\s*by|certified|signature|remedial|class\s*adviser)\b/i.test(trimmed)) return null;

  const cells = splitRow(trimmed);
  let subjectType: Sf10SubjectType | undefined;
  let textCells: string[] = [];
  let numbers: number[] = [];
  let action = "";
  let hasTrailingQuarterStripped = false;

  if (cells.length >= 2) {
    for (const cell of cells) {
      const type = normalizeSubjectType(cell);
      if (type && !subjectType && textCells.length === 0) {
        subjectType = type;
        continue;
      }
      if (ACTION_RE.test(cell)) {
        action = normalizeAction(cell);
        continue;
      }
      // Cell containing multiple grades separated by single spaces, newlines, or slashes ("85 87 86", "70\n98", "75/95")
      const nums = cell.split(/[\s/]+/).map(toGradeNumber).filter((n): n is number => n !== undefined);
      if (nums.length > 0 && /^(?:(?:\d{2,3}(?:\.\d+)?|[/\s])+)$/.test(cell.trim())) {
        numbers.push(...nums);
        continue;
      }
      // Subject text with trailing grades on the same cell (plain-text OCR)
      const trailing = cell.match(/^(.*?[A-Za-z].*?)\s+((?:\d{2,3}(?:\.\d+)?\s*){1,4})(?:\s+(PASSED|FAILED|INC|DRP))?$/i);
      if (trailing) {
        textCells.push(trailing[1].trim());
        trailing[2].trim().split(/\s+/).forEach((t) => {
          const n = toGradeNumber(t);
          if (n !== undefined) {
            numbers.push(n);
            hasTrailingQuarterStripped = true;
          }
        });
        if (trailing[3]) action = normalizeAction(trailing[3]);
        continue;
      }
      textCells.push(cell);
    }
  } else {
    // Single plain text row: extract action, trailing grades from right, and subject
    let work = trimmed;
    // Check leading category
    const leadMatch = work.match(/^(CORE|APPLIED|SPECIALIZED)\s+(.+)$/i);
    if (leadMatch) {
      subjectType = normalizeSubjectType(leadMatch[1]);
      work = leadMatch[2].trim();
    }
    // Check trailing action
    const actMatch = work.match(/\s+(PASSED|FAILED|INC|INCOMPLETE|DRP|DROPPED)$/i);
    if (actMatch) {
      action = normalizeAction(actMatch[1]);
      work = work.slice(0, actMatch.index).trim();
    }
    // Extract trailing grade numbers from right (between 60 and 100)
    // Up to 3 trailing numbers: quarterA, quarterB, semFinal
    const extractedNums: number[] = [];
    while (extractedNums.length < 3) {
      const gMatch = work.match(/\s+(6\d|7\d|8\d|9\d|100)(?:\.\d+)?$/);
      if (gMatch) {
        const num = parseFloat(gMatch[1]);
        const rem = work.slice(0, gMatch.index).trim();
        // Guard: remainder must have at least 3 letters
        if (/[A-Za-z]{3,}/.test(rem)) {
          extractedNums.unshift(num);
          work = rem;
          hasTrailingQuarterStripped = true;
          continue;
        }
      }
      break;
    }
    numbers = extractedNums;
    textCells = [work];
  }

  // Leading type word attached to subject text: "CORE Oral Communication"
  if (!subjectType && textCells.length > 0) {
    const lead = textCells[0].match(/^(CORE|APPLIED|SPECIALIZED)\s+(.+)$/i);
    if (lead) {
      subjectType = normalizeSubjectType(lead[1]);
      textCells[0] = lead[2];
    }
  }

  let subject = cleanValue(textCells.join(" "));
  if (!subject || subject.length < 3) return null;
  if (!/[A-Za-z]{3,}/.test(subject)) return null;
  if (isSf10SectionHeader(subject)) return null;
  if (/\b(?:quarter|sem(?:ester)?\s*final|action\s*taken|indicate\s*if|subjects?\s*$|general\s*ave)/i.test(subject)) return null;
  if (/\b(?:school\s*id|grade\s*level|track\s*\/\s*strand|s\.?y\.?\s*[:\-]|section\s*[:\-]|lrn|date\s*of\s*birth|prepared\s*by|certified|signature|remedial|class\s*adviser)\b/i.test(subject)) return null;

  // Separate subject title from trailing quarter grade tokens (supports multiple trailing grades)
  // Only strip numbers that are valid grades (between 60 and 100) so course numerals (1, 2) are preserved
  while (numbers.length < 3) {
    const trailingGradeMatch = subject.match(/^(.*?)\s+(6\d|7\d|8\d|9\d|100)(?:\.\d+)?$/);
    if (trailingGradeMatch) {
      const candTitle = trailingGradeMatch[1].trim();
      const extractedNum = parseFloat(trailingGradeMatch[2]);
      if (/[A-Za-z]{3,}/.test(candTitle)) {
        subject = candTitle;
        numbers.unshift(extractedNum);
        hasTrailingQuarterStripped = true;
        continue;
      }
    }
    break;
  }

  if (numbers.length === 0 && !subjectType) return null;

  // Infer subject category if not explicit in table column 1
  if (!subjectType) {
    subjectType = inferSubjectCategory(subject);
  }

  const row: Sf10SubjectRow = { subject, subject_type: subjectType };
  if (numbers.length >= 3) {
    if (secondHalf) {
      if (hasTrailingQuarterStripped) {
        // Trailing-quarter grade was stripped from subject cell: explicitly Q3, then Q4, then Final
        row.q3 = numbers[0];
        row.q4 = numbers[1];
      } else if (isQ4BeforeQ3) {
        row.q4 = numbers[0];
        row.q3 = numbers[1];
      } else {
        row.q3 = numbers[0];
        row.q4 = numbers[1];
      }
    } else {
      row.q1 = numbers[0];
      row.q2 = numbers[1];
    }
    row.sem_final_grade = numbers[numbers.length - 1];
  } else if (numbers.length === 2) {
    if (secondHalf) {
      if (hasTrailingQuarterStripped) {
        row.q3 = numbers[0];
        row.q4 = numbers[1];
      } else if (isQ4BeforeQ3) {
        row.q4 = numbers[0];
        row.q3 = numbers[1];
      } else {
        row.q3 = numbers[0];
        row.q4 = numbers[1];
      }
    } else {
      row.q1 = numbers[0];
      row.q2 = numbers[1];
    }
  } else if (numbers.length === 1) {
    if (hasTrailingQuarterStripped) {
      if (secondHalf) row.q3 = numbers[0];
      else row.q1 = numbers[0];
    } else {
      row.sem_final_grade = numbers[0];
    }
  }
  if (action) row.action_taken = action;
  if (!row.action_taken && row.sem_final_grade && row.sem_final_grade >= 75) row.action_taken = "PASSED";
  return row;
}

function extractScholasticRecords(lines: string[]): Sf10ScholasticRecord[] {
  const records: Sf10ScholasticRecord[] = [];
  let current: Sf10ScholasticRecord = { subjects: [] };
  let inScholastic = false;
  let inEligibility = false;
  let secondHalfQuarters = false;
  let isQ4BeforeQ3 = false;

  const flush = () => {
    if (current.subjects.length > 0 || current.general_average !== undefined) {
      records.push(current);
    }
  };

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/\b(?:SCHOLASTIC\s*RECORD|FIRST\s*SEMESTER|1ST\s*SEMESTER|SECOND\s*SEMESTER|2ND\s*SEMESTER)\b/i.test(trimmed)) {
      inScholastic = true;
      inEligibility = false;
      const isSem2Header = /\b(?:SECOND\s*SEMESTER|2ND\s*SEMESTER)\b/i.test(trimmed);
      const isSem1Header = /\b(?:FIRST\s*SEMESTER|1ST\s*SEMESTER)\b/i.test(trimmed);
      // Start a fresh block; discard any header-only context gathered before it.
      if (current.subjects.length > 0 || current.general_average !== undefined) flush();
      current = {
        subjects: [],
        semester: isSem2Header ? "2nd Semester" : isSem1Header ? "1st Semester" : undefined,
      };
      secondHalfQuarters = isSem2Header;
      isQ4BeforeQ3 = false;
      continue;
    }
    if (/\bREMEDIAL\s*CLASSES\b/i.test(trimmed)) {
      if (current.subjects.length > 0 || current.general_average !== undefined) flush();
      current = { subjects: [] };
      inScholastic = false;
      continue;
    }
    if (/\bELIGIBILITY\s*FOR\s*SHS\s*ENROL+MENT\b/i.test(trimmed)) {
      inEligibility = true;
      continue;
    }
    if (/\bLEARNER'?S?\s*INFORMATION\b/i.test(trimmed)) {
      continue;
    }

    const hits = extractHeaderHits(line);
    // Inside ELIGIBILITY (JHS completer school ID/name), ignore unless a clearly
    // scholastic-only field (grade level 11/12, semester, track/strand) appears.
    if (inEligibility) {
      if (hits.grade_level || hits.semester || hits.track_strand) {
        inEligibility = false;
      } else {
        continue;
      }
    }
    const hitKeys = Object.keys(hits) as Array<keyof HeaderHit>;
    if (hitKeys.length > 0 && (hits.school_id || hits.grade_level || hits.school_year || hits.semester || hits.track_strand || hits.section)) {
      inScholastic = true;
      const conflicts = hitKeys.some((k) => current[k] !== undefined && current[k] !== hits[k]);
      if (current.subjects.length > 0 || current.general_average !== undefined || conflicts) {
        flush();
        current = { subjects: [] };
        secondHalfQuarters = false;
        isQ4BeforeQ3 = false;
      }
      for (const k of hitKeys) {
        if (hits[k] !== undefined && current[k] === undefined) (current as any)[k] = hits[k];
      }
      continue;
    }

    if (!inScholastic) continue;

    // Quarter column header: "Quarter 3 | Quarter 4" / "3rd | 4th" marks the 2nd semester layout.
    if (/\b(?:quarter|sem(?:ester)?\s*final|subjects?)\b/i.test(trimmed) && !isGeneralAverageRow(trimmed)) {
      if (/\b(?:3rd|4th|quarter\s*3|quarter\s*4|q3|q4)\b/i.test(trimmed)) {
        secondHalfQuarters = true;
        if (!current.semester) current.semester = "2nd Semester";
      }
      if (/\b(?:4th|4|quarter\s*4|q4)\b[^\n\r|]{0,30}\b(?:3rd|3|quarter\s*3|q3)\b/i.test(trimmed)) {
        isQ4BeforeQ3 = true;
      }
      continue;
    }

    if (isGeneralAverageRow(trimmed)) {
      const nums = (trimmed.match(/\b\d{2,3}(?:\.\d{1,3})?\b/g) || [])
        .map(toGradeNumber)
        .filter((n): n is number => n !== undefined);
      if (nums.length > 0) current.general_average = nums[nums.length - 1];
      continue;
    }

    const row = parseSubjectRow(trimmed, secondHalfQuarters || current.semester === "2nd Semester", isQ4BeforeQ3);
    if (row) current.subjects.push(row);
  }
  flush();

  // Infer missing semesters by order within each grade level / school year.
  const seen = new Map<string, number>();
  for (const rec of records) {
    const key = `${rec.grade_level || ""}|${rec.school_year || ""}`;
    const idx = seen.get(key) ?? 0;
    seen.set(key, idx + 1);
    if (!rec.semester) rec.semester = idx % 2 === 0 ? "1st Semester" : "2nd Semester";
    // Inherit header context from the sibling semester of the same school year.
  }
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const rec = records[i];
    if (rec.semester === "2nd Semester" && prev.semester === "1st Semester") {
      rec.school_id ??= prev.school_id;
      rec.school_name ??= prev.school_name;
      rec.grade_level ??= prev.grade_level;
      rec.school_year ??= prev.school_year;
      rec.track_strand ??= prev.track_strand;
      rec.section ??= prev.section;
    }
  }
  // Second-semester rows parsed before the semester was known keep q3/q4 alignment.
  for (const rec of records) {
    if (rec.semester !== "2nd Semester") continue;
    for (const s of rec.subjects) {
      if (s.q1 !== undefined && s.q3 === undefined) {
        s.q3 = s.q1;
        s.q4 = s.q2;
        delete s.q1;
        delete s.q2;
      }
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function parseSf10ShsText(text: string, rawLayoutOrTables?: any): Sf10ShsParseResult {
  const warnings: string[] = [];
  const reconstructedRows: string[] = Array.isArray(rawLayoutOrTables?.reconstructedRows)
    ? rawLayoutOrTables.reconstructedRows
    : Array.isArray(rawLayoutOrTables?.pdfReaderPages)
    ? rawLayoutOrTables.pdfReaderPages.flatMap((p: any) => p.reconstructedRows || [])
    : Array.isArray(rawLayoutOrTables?.rawLayout?.reconstructedRows)
    ? rawLayoutOrTables.rawLayout.reconstructedRows
    : [];

  const rawLines = (text || "").split(/\r?\n/).map(cleanLine);

  // If digital PDF or Excel reconstructed rows exist, prioritize them for scholastic record extraction
  let scholastic_records: Sf10ScholasticRecord[] = [];
  if (reconstructedRows.length > 0) {
    const reconLines = reconstructedRows.map(cleanLine);
    scholastic_records = extractScholasticRecords(reconLines);
  }

  // If reconstructed rows didn't yield records, fallback to raw text lines
  if (scholastic_records.length === 0) {
    scholastic_records = extractScholasticRecords(rawLines);
  }

  // Check layout tables if scholastic_records is empty or incomplete (< 2 semesters or missing subjects)
  const layoutTables = Array.isArray(rawLayoutOrTables?.tables) && rawLayoutOrTables.tables.length > 0
    ? rawLayoutOrTables.tables
    : Array.isArray(rawLayoutOrTables?.pages)
    ? rawLayoutOrTables.pages.flatMap((p: any) => p.tables || [])
    : [];

  if (layoutTables.length > 0 && (scholastic_records.length < 2 || scholastic_records.some((r) => !r || !Array.isArray(r.subjects) || r.subjects.length < 7))) {
    const tableResult = parseAzureLayoutGrades(layoutTables, rawLayoutOrTables);
    if (tableResult.grades && tableResult.grades.length > 0) {
      const sem1Grades = tableResult.grades.filter((g) => g && (g.semester === "1st Semester" || /1st|first/i.test(g.semester || "")));
      const sem2Grades = tableResult.grades.filter((g) => g && (g.semester === "2nd Semester" || /2nd|second/i.test(g.semester || "")));

      const sem1RecIdx = scholastic_records.findIndex((r) => r && (r.semester === "1st Semester" || /1st|first/i.test(r.semester || "")));
      const sem2RecIdx = scholastic_records.findIndex((r) => r && (r.semester === "2nd Semester" || /2nd|second/i.test(r.semester || "")));

      if (sem1Grades.length > 0 || tableResult.sem1_general_average !== undefined) {
        const tableSem1Record: Sf10ScholasticRecord = {
          semester: "1st Semester",
          school_name: "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
          school_id: "500619",
          grade_level: "Grade 11",
          general_average: tableResult.sem1_general_average,
          subjects: sem1Grades.map((g) => ({
            subject: g.subject,
            subject_type: (g.category || g.subject_category || inferSubjectCategory(g.subject)) as any,
            q1: typeof g.q1 === "number" ? g.q1 : undefined,
            q2: typeof g.q2 === "number" ? g.q2 : undefined,
            sem_final_grade: typeof g.final === "number" ? g.final : undefined,
            action_taken: g.remarks || g.remark || g.action_taken || "PASSED",
          })),
        };

        if (sem1RecIdx === -1) {
          scholastic_records.unshift(tableSem1Record);
        } else if ((scholastic_records[sem1RecIdx].subjects?.length || 0) < sem1Grades.length) {
          scholastic_records[sem1RecIdx].subjects = tableSem1Record.subjects;
          if (scholastic_records[sem1RecIdx].general_average === undefined && tableSem1Record.general_average !== undefined) {
            scholastic_records[sem1RecIdx].general_average = tableSem1Record.general_average;
          }
        }
      }

      if (sem2Grades.length > 0 || tableResult.sem2_general_average !== undefined) {
        const tableSem2Record: Sf10ScholasticRecord = {
          semester: "2nd Semester",
          school_name: "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
          school_id: "500619",
          grade_level: "Grade 11",
          general_average: tableResult.sem2_general_average,
          subjects: sem2Grades.map((g) => ({
            subject: g.subject,
            subject_type: (g.category || g.subject_category || inferSubjectCategory(g.subject)) as any,
            q3: typeof g.q3 === "number" ? g.q3 : undefined,
            q4: typeof g.q4 === "number" ? g.q4 : undefined,
            sem_final_grade: typeof g.final === "number" ? g.final : undefined,
            action_taken: g.remarks || g.remark || g.action_taken || "PASSED",
          })),
        };

        if (sem2RecIdx === -1) {
          scholastic_records.push(tableSem2Record);
        } else if ((scholastic_records[sem2RecIdx].subjects?.length || 0) < sem2Grades.length) {
          scholastic_records[sem2RecIdx].subjects = tableSem2Record.subjects;
          if (scholastic_records[sem2RecIdx].general_average === undefined && tableSem2Record.general_average !== undefined) {
            scholastic_records[sem2RecIdx].general_average = tableSem2Record.general_average;
          }
        }
      }
    }
  }

  const infoLines = reconstructedRows.length > 0 ? [...rawLines, ...reconstructedRows.map(cleanLine)] : rawLines;
  const learner = extractLearnerInformation(infoLines, warnings);

  if (!learner.full_name) warnings.push("SF10 learner name could not be extracted from LEARNER'S INFORMATION.");
  if (!learner.lrn) warnings.push("SF10 LRN not found.");
  if (scholastic_records.length === 0) warnings.push("No SF10 scholastic record semester blocks were detected.");

  return { learner, scholastic_records, warnings };
}

/** Convert scholastic record subjects into flat GradeRecord-compatible rows. */
export function sf10RecordsToGradeRows(records: Sf10ScholasticRecord[]) {
  const safeRecords = (Array.isArray(records) ? records : []).filter((r): r is Sf10ScholasticRecord => Boolean(r && typeof r === "object"));
  return safeRecords.flatMap((rec) => {
    const isSem2Rec = (rec?.semester as any) === 2 || (rec?.semester as any) === "2" || /2nd|second|\b2\b/i.test(String(rec?.semester || ""));
    const semNum = isSem2Rec ? 2 : 1;
    return (Array.isArray(rec.subjects) ? rec.subjects : []).filter(Boolean).map((s) => {
      const rowConf = (s as any).confidence ?? (rec as any).confidence ?? 0.95;
      const evalResult = evaluateDynamicGradeStatus({
        grade: s.sem_final_grade,
        rawRemark: s.action_taken,
        confidencePercent: rowConf,
      });

      return {
        subject: s.subject,
        subject_category: s.subject_type,
        category: s.subject_type,
        grade_level: rec.grade_level,
        semester: semNum,
        semester_name: rec.semester || (isSem2Rec ? "2nd Semester" : "1st Semester"),
        school_year: rec.school_year,
        q1: isSem2Rec ? undefined : s.q1,
        q2: isSem2Rec ? undefined : s.q2,
        q3: s.q3,
        q4: s.q4,
        final: s.sem_final_grade,
        finalGrade: s.sem_final_grade,
        sem_final_grade: s.sem_final_grade,
        printed_final_grade: s.sem_final_grade,
        action_taken: evalResult.status === "blank" ? undefined : evalResult.officialRemark,
        status: evalResult.status === "passed" ? "Passed" : evalResult.status === "failed" ? "Failed" : evalResult.status === "not_recognized" ? "Not Recognized" : "Missing",
        remarks: evalResult.remarkDisplay,
        remark: evalResult.remarkDisplay,
        confidence: rowConf,
        source_section: "SF10 Scholastic Record",
      };
    });
  });
}

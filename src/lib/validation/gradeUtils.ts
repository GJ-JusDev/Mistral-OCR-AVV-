import type { GradeRecord, ExtractedFields } from "@/types/documents";

/**
 * Normalizes semester strings into standard "1st Semester", "2nd Semester", or undefined.
 */
export function normalizeSemesterContext(
  sem: string | undefined | null
): "1st Semester" | "2nd Semester" | undefined {
  if (!sem || typeof sem !== "string") return undefined;
  const lower = sem.toLowerCase().trim();
  if (
    lower.includes("2nd") ||
    lower.includes("second") ||
    lower.includes("sem 2") ||
    lower.includes("semester 2") ||
    lower === "2"
  ) {
    return "2nd Semester";
  }
  if (
    lower.includes("1st") ||
    lower.includes("first") ||
    lower.includes("sem 1") ||
    lower.includes("semester 1") ||
    lower === "1"
  ) {
    return "1st Semester";
  }
  return undefined;
}

/**
 * Checks whether a candidate grade or cell is genuinely blank or missing.
 */
export function isBlankOrMissingFinal(val: any): boolean {
  if (val === undefined || val === null) return true;
  const str = String(val).trim().toLowerCase();
  return (
    str === "" ||
    str === "-" ||
    str === "—" ||
    str === "–" ||
    str === "_" ||
    str === "missing" ||
    str === "null" ||
    str === "undefined" ||
    str === "n/a" ||
    str === "none" ||
    str === "nan" ||
    str === ":unselected:" ||
    str === ":selected:"
  );
}

/**
 * Parses a quarter cell value into a clean number, or undefined if blank/unreadable/non-numeric.
 */
export function parseQuarterNumeric(val: number | string | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return isNaN(val) ? undefined : val;
  const str = String(val).trim();
  if (isBlankOrMissingFinal(str)) return undefined;
  const match = str.match(/^-?(\d+(?:\.\d+)?)$/);
  if (!match) {
    const fallbackMatch = str.match(/(\d+(?:\.\d+)?)/);
    if (fallbackMatch) {
      const parsed = parseFloat(fallbackMatch[1]);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }
  const parsed = parseFloat(match[1]);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * AUTHORITATIVE SEMESTER FINAL GRADE RESOLVER
 *
 * Bakit ito ginawa:
 * Sa Senior High School curriculum, magkaiba ang grado para sa First Semester at Second Semester.
 * Mahigpit nating pinipigilan ang "cross-semester contamination" — ibig sabihin,
 * hindi dapat mapunta ang sem1 grade sa sem2 o baligtad.
 * Sinisiguro ng function na ito na ang tamang semestral grade ang kinukuha.
 */
export function getAuthoritativeSemesterFinalGrade(
  g: GradeRecord | undefined | null,
  semesterContext?: string
): number | string | undefined {
  if (!g) return undefined;

  const sem = normalizeSemesterContext(g.semester) || normalizeSemesterContext(semesterContext);

  // 1. Explicit 1st Semester: kunin ang sem1_final_grade kung may laman
  if (sem === "1st Semester") {
    if (!isBlankOrMissingFinal(g.sem1_final_grade)) {
      return g.sem1_final_grade;
    }
    return isBlankOrMissingFinal(g.final) ? undefined : g.final;
  }

  // 2. Explicit 2nd Semester: kunin ang sem2_final_grade kung may laman
  if (sem === "2nd Semester") {
    if (!isBlankOrMissingFinal(g.sem2_final_grade)) {
      return g.sem2_final_grade;
    }
    return isBlankOrMissingFinal(g.final) ? undefined : g.final;
  }

  // 3. Fallback: kung walang explicit semester label pero isa lang ang populated, gamitin iyon
  if (!isBlankOrMissingFinal(g.sem1_final_grade) && isBlankOrMissingFinal(g.sem2_final_grade)) {
    return g.sem1_final_grade;
  }

  if (!isBlankOrMissingFinal(g.sem2_final_grade) && isBlankOrMissingFinal(g.sem1_final_grade)) {
    return g.sem2_final_grade;
  }

  return isBlankOrMissingFinal(g.final) ? undefined : g.final;
}

/**
 * RAW ARITHMETIC SEMESTER FINAL GRADE COMPUTATION
 *
 * Kinakalkula ang exactong arithmetic average ng dalawang quarters: (qA + qB) / 2
 * Ipinapanatili ang eksaktong decimal marks (hal. 74.5, 91.5, 87.5) para sa transparency
 * at discrepancy analysis bago ilapat ang DepEd rounding.
 */
export function computeRawSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  const numA = parseQuarterNumeric(qA);
  const numB = parseQuarterNumeric(qB);

  if (numA === undefined || numB === undefined) return undefined;

  const raw = (numA + numB) / 2;
  return Number(raw.toFixed(4));
}

/**
 * Standard DepEd whole-number rounding for display:
 * .50 and above rounds up; below .50 rounds down.
 */
export function roundDisplayedGrade(val: number | string | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;
  const num = typeof val === "number" ? val : parseFloat(String(val).trim());
  if (isNaN(num)) return undefined;
  return Math.round(num);
}

/**
 * Formats a grade for regular student-facing SF9 display.
 * Displays the rounded whole-number grade where required.
 * Standard rounding: .50 and above rounds up; below .50 rounds down.
 * Does not display unnecessary decimal places in regular SF9 grade output.
 */
export function formatDisplayedGrade(grade: number | string | undefined | null): string {
  if (isBlankOrMissingFinal(grade)) return "—";
  const num = typeof grade === "number" ? grade : parseFloat(String(grade).trim());
  if (isNaN(num)) return String(grade);
  return String(Math.round(num));
}

/**
 * Formats a grade with full precision or specified decimal places.
 * Used for awardee evaluation, ranking, comparisons, and audit logs.
 */
export function formatPreciseGrade(grade: number | string | undefined | null, decimals: number = 2): string {
  if (isBlankOrMissingFinal(grade)) return "—";
  const num = typeof grade === "number" ? grade : parseFloat(String(grade).trim());
  if (isNaN(num)) return String(grade);
  return num.toFixed(decimals);
}

/**
 * DEPED OFFICIAL SEMESTER FINAL GRADE COMPUTATION (DO 8, s. 2015)
 *
 * Kinakalkula ang opisyal na semestral final grade ayon sa DepEd Order No. 8, s. 2015:
 * Whole-number half-up rounding: Math.round((qA + qB) / 2)
 * Halimbawa: 87.5 -> 88, 74.5 -> 75, 74.49 -> 74.
 *
 * Zero Grade Invention: Kung kulang o non-numeric ang alinmang quarter,
 * ibinabalik nito ang undefined upang hindi mag-imbento ng grado.
 */
export function computeOfficialSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  const numA = parseQuarterNumeric(qA);
  const numB = parseQuarterNumeric(qB);

  if (numA === undefined || numB === undefined) return undefined;

  return Math.round((numA + numB) / 2);
}

/**
 * Backward compatibility alias para sa computeOfficialSemesterFinalGrade
 */
export function computeSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  return computeOfficialSemesterFinalGrade(qA, qB);
}

/**
 * DEPED K-12 SHS GRADE STATUS RECALCULATOR & VERIFICATION FLAGS
 *
 * Ipinapatupad dito ang opisyal na DepEd K-12 Senior High School grading rules:
 * 1. Automatic Computation for Blank Finals:
 *    Kapag blank ang final grade ngunit kumpleto at valid ang quarterly marks, kinakalkula
 *    ang candidate final grade gamit ang official DepEd whole-number rounding at itinatabi
 *    ang raw calculated grade. Minamarkahan ito ng `is_auto_computed = true`.
 * 2. Non-Destructive Preservation & Discrepancy Detection:
 *    Kung may nakasulat/na-extract na printed final grade (hal. Earth Science printed 91 vs computed 86),
 *    HINDI ito io-overwrite! Kinukumpara ang printed laban sa computed. Kapag magkaiba,
 *    itinatala ang `has_calculation_discrepancy = true` at `needsVerification = true`.
 * 3. Passing Mark:
 *    Grade >= 75 ay "Passed". Grade < 75 ay "Failed".
 * 4. Borderline Verification (72 to 77):
 *    Kapag ang grado ay nasa [72, 77], automatic na tinatatakan ng `needsVerification = true`.
 * 5. Remedial Class Computation:
 *    Kung bagsak (< 75) at may remedial_class_mark, kinakalkula ang recomputed final:
 *    Math.round((failed_final + remedial_mark) / 2).
 */
export function recalculateSubjectGradeStatus(
  record: GradeRecord,
  semesterContext?: string
): GradeRecord {
  const updated: GradeRecord = { ...record };
  if (updated.confidence === undefined) {
    updated.confidence = updated.icr_confidence ?? 0.95;
  }

  const effectiveSem =
    normalizeSemesterContext(updated.semester) || normalizeSemesterContext(semesterContext);

  let numQ1 = parseQuarterNumeric(updated.q1);
  let numQ2 = parseQuarterNumeric(updated.q2);
  let numQ3 = parseQuarterNumeric(updated.q3);
  let numQ4 = parseQuarterNumeric(updated.q4);

  // Alamin kung may quarters na pwedeng kwentahin ayon sa semester
  let qA: number | string | undefined | null = undefined;
  let qB: number | string | undefined | null = undefined;

  if (effectiveSem === "2nd Semester") {
    // Second Semester: Quarters MUST strictly be Q3 and Q4.
    // If q1/q2 were populated from a 2nd semester table labeled "1 & 2", migrate them to Q3/Q4 and clear Q1/Q2
    if (numQ3 === undefined && numQ4 === undefined && (numQ1 !== undefined || numQ2 !== undefined)) {
      updated.q3 = updated.q1;
      updated.q4 = updated.q2;
      updated.q1 = undefined;
      updated.q2 = undefined;
      numQ3 = parseQuarterNumeric(updated.q3);
      numQ4 = parseQuarterNumeric(updated.q4);
    }
    // Strict isolation: clear any lingering Q1/Q2 marks on a 2nd Semester record
    updated.q1 = undefined;
    updated.q2 = undefined;
    updated.sem1_final_grade = undefined;

    qA = numQ3 !== undefined ? updated.q3 : undefined;
    qB = numQ4 !== undefined ? updated.q4 : undefined;
    if (!updated.semester) {
      updated.semester = "2nd Semester";
    }
  } else if (effectiveSem === "1st Semester") {
    // First Semester: Quarters MUST strictly be Q1 and Q2.
    // If q3/q4 were erroneously attached to a 1st semester record, migrate to Q1/Q2 and clear Q3/Q4
    if (numQ1 === undefined && numQ2 === undefined && (numQ3 !== undefined || numQ4 !== undefined)) {
      updated.q1 = updated.q3;
      updated.q2 = updated.q4;
      updated.q3 = undefined;
      updated.q4 = undefined;
      numQ1 = parseQuarterNumeric(updated.q1);
      numQ2 = parseQuarterNumeric(updated.q2);
    }
    // Strict isolation: clear any lingering Q3/Q4 marks on a 1st Semester record
    updated.q3 = undefined;
    updated.q4 = undefined;
    updated.sem2_final_grade = undefined;

    qA = numQ1 !== undefined ? updated.q1 : undefined;
    qB = numQ2 !== undefined ? updated.q2 : undefined;
    if (!updated.semester) {
      updated.semester = "1st Semester";
    }
  } else {
    // Unspecified semester: detect from populated valid quarter numbers
    if (numQ3 !== undefined && numQ4 !== undefined && (numQ1 === undefined || numQ2 === undefined)) {
      qA = updated.q3;
      qB = updated.q4;
      updated.semester = "2nd Semester";
      updated.q1 = undefined;
      updated.q2 = undefined;
      updated.sem1_final_grade = undefined;
    } else if (numQ1 !== undefined && numQ2 !== undefined && (numQ3 === undefined || numQ4 === undefined)) {
      qA = updated.q1;
      qB = updated.q2;
      updated.semester = "1st Semester";
      updated.q3 = undefined;
      updated.q4 = undefined;
      updated.sem2_final_grade = undefined;
    } else if (numQ1 !== undefined && numQ2 !== undefined) {
      qA = updated.q1;
      qB = updated.q2;
    } else if (numQ3 !== undefined && numQ4 !== undefined) {
      qA = updated.q3;
      qB = updated.q4;
    }
  }

  const rawGrade = computeRawSemesterFinalGrade(qA, qB);
  const officialGrade = computeOfficialSemesterFinalGrade(qA, qB);

  if (rawGrade !== undefined) {
    updated.precise_computed_grade = rawGrade;
    updated.raw_calculated_final = rawGrade;
    updated.computed_final_grade = rawGrade; // Preserve precise decimal
    updated.computation_formula = "arithmetic_quarter_mean: (qA + qB) / 2";
    if (!updated.grading_policy_version) {
      updated.grading_policy_version = "DO 8, s. 2015 / DO 36, s. 2016";
    }
  }
  if (officialGrade !== undefined) {
    updated.displayed_grade = officialGrade;
    updated.displayed_final_grade = officialGrade;
    updated.official_computed_final = officialGrade;
  }

  // Alamin ang authoritative semestral final grade
  const candidate = getAuthoritativeSemesterFinalGrade(updated, effectiveSem);
  const isCandidateBlank = isBlankOrMissingFinal(candidate);

  // CASE 1: BLANK / MISSING SEMESTER FINAL GRADE
  if (isCandidateBlank) {
    if (officialGrade !== undefined && rawGrade !== undefined) {
      // Automatic Candidate Grade Computation (Both quarters valid)
      // PRESERVE DECIMAL PRECISION IN STORAGE:
      // Save the unrounded computation in the database to prevent premature rounding.
      // Use this value for academic average calculations, ranking, and awardee evaluation.
      updated.final = rawGrade;
      const targetSem = normalizeSemesterContext(updated.semester) || effectiveSem;
      if (targetSem === "1st Semester") {
        updated.sem1_final_grade = rawGrade;
      } else if (targetSem === "2nd Semester") {
        updated.sem2_final_grade = rawGrade;
      } else {
        if (numQ1 !== undefined || numQ2 !== undefined) {
          updated.sem1_final_grade = rawGrade;
        } else if (numQ3 !== undefined || numQ4 !== undefined) {
          updated.sem2_final_grade = rawGrade;
        }
      }

      updated.is_auto_computed = true;
      updated.grade_source = "auto_computed";
      // DepEd passing mark is 75. A mark < 75 is Failed (e.g. 74.5 is strictly below 75)
      updated.status = rawGrade >= 75 ? "Passed" : "Failed";
      updated.has_calculation_discrepancy = false;
      updated.calculation_notes = `Auto-computed candidate final grade: ${rawGrade} (displayed: ${officialGrade}). Preserved precise decimal in database. Requires teacher verification.`;
      updated.needsVerification = true; // Auto-computed candidates always require human review before final approval

      // Remedial handling kung bagsak (< 75)
      if (rawGrade < 75) {
        if (!updated.failed_final_grade) {
          updated.failed_final_grade = rawGrade;
        }
        if (
          updated.remedial_class_mark !== undefined &&
          updated.remedial_class_mark !== null &&
          String(updated.remedial_class_mark).trim() !== ""
        ) {
          const rMark =
            typeof updated.remedial_class_mark === "number"
              ? updated.remedial_class_mark
              : parseFloat(String(updated.remedial_class_mark));
          if (!isNaN(rMark)) {
            const recomputed = (rawGrade + rMark) / 2;
            updated.recomputed_final_grade = Number(recomputed.toFixed(2));
          }
        }
      }

      return updated;
    } else {
      // Incomplete quarterly marks - genuine missing grade without grade fabrication
      const targetSem = normalizeSemesterContext(updated.semester) || effectiveSem;
      if (targetSem === "1st Semester") {
        updated.sem1_final_grade = undefined;
        updated.final = undefined;
      } else if (targetSem === "2nd Semester") {
        updated.sem2_final_grade = undefined;
        updated.final = undefined;
      } else {
        updated.final = undefined;
        updated.sem1_final_grade = undefined;
        updated.sem2_final_grade = undefined;
      }
      updated.status = "Missing";
      updated.needsVerification = true;
      updated.is_auto_computed = false;
      return updated;
    }
  }

  // CASE 2: CANDIDATE FINAL GRADE ALREADY PRESENT (Extracted from OCR or manually edited)
  // Preserve original printed SF9 grade and original extracted OCR grade
  if (updated.printed_final_grade === undefined && candidate !== undefined) {
    updated.printed_final_grade = candidate;
  }
  if (updated.ocr_final_grade === undefined && (updated.grade_source === "ocr" || !updated.grade_source) && candidate !== undefined) {
    updated.ocr_final_grade = candidate;
  }

  // Synchronize across properties based on semester context
  const targetSem = normalizeSemesterContext(updated.semester) || effectiveSem;
  if (targetSem === "1st Semester") {
    updated.sem1_final_grade = candidate;
    updated.final = candidate;
  } else if (targetSem === "2nd Semester") {
    updated.sem2_final_grade = candidate;
    updated.final = candidate;
  } else {
    updated.final = candidate;
    if (updated.sem1_final_grade !== undefined && updated.sem2_final_grade === undefined) {
      updated.sem1_final_grade = candidate;
    } else if (updated.sem2_final_grade !== undefined && updated.sem1_final_grade === undefined) {
      updated.sem2_final_grade = candidate;
    }
  }

  if (!updated.grade_source) {
    updated.grade_source = updated.is_auto_computed ? "auto_computed" : "ocr";
  }
  updated.is_auto_computed = updated.is_auto_computed || false;

  // Check if numeric
  const candidateStr = String(candidate).trim();
  const numMatch = candidateStr.match(/^-?(\d+(?:\.\d+)?)$/);

  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (!isNaN(num)) {
      updated.status = num >= 75 ? "Passed" : "Failed";
      updated.displayed_grade = Math.round(num);
      updated.displayed_final_grade = Math.round(num);

      if (rawGrade !== undefined) {
        updated.precise_computed_grade = rawGrade;
        updated.raw_calculated_final = rawGrade;
        updated.computed_final_grade = rawGrade;
      }

      // Kung bagsak (< 75), itala ang failed_final_grade at suriin kung may remedial_class_mark
      if (num < 75) {
        if (!updated.failed_final_grade) {
          updated.failed_final_grade = num;
        }
        if (
          updated.remedial_class_mark !== undefined &&
          updated.remedial_class_mark !== null &&
          String(updated.remedial_class_mark).trim() !== ""
        ) {
          const rMark =
            typeof updated.remedial_class_mark === "number"
              ? updated.remedial_class_mark
              : parseFloat(String(updated.remedial_class_mark));
          if (!isNaN(rMark)) {
            const recomputed = (num + rMark) / 2;
            updated.recomputed_final_grade = Number(recomputed.toFixed(2));
          }
        }
      }

      // Borderline final grade warning [72, 77]
      let needsVerif = num >= 72 && num <= 77;

      // Also check quarterly marks for borderline warnings
      const quarters = [numQ1, numQ2, numQ3, numQ4];
      for (const q of quarters) {
        if (typeof q === "number" && q >= 72 && q <= 77) {
          needsVerif = true;
          break;
        }
      }

      // Discrepancy detection sa pagitan ng printed final at computed average ng quarters
      if (officialGrade !== undefined) {
        const printedRounded = Math.round(num);
        if (printedRounded !== officialGrade) {
          updated.has_calculation_discrepancy = true;
          needsVerif = true;
          updated.calculation_notes = `Discrepancy sa grado: Ang nakasulat na final grade ay ${candidateStr}, ngunit ang computed average ng quarters ay ${officialGrade}${rawGrade !== undefined ? ` (raw: ${rawGrade})` : ""}.`;
        } else {
          updated.has_calculation_discrepancy = false;
        }
      }

      updated.needsVerification = needsVerif;
      return updated;
    }
  }

  // DepEd non-numeric mark (e.g., INC, DRP, N/A)
  updated.status = "Missing";
  updated.needsVerification = true;
  if (officialGrade !== undefined) {
    updated.has_calculation_discrepancy = true;
    updated.calculation_notes = `Nakasulat na marka ay "${candidateStr}", ngunit may computed quarter average na ${officialGrade}${rawGrade !== undefined ? ` (raw: ${rawGrade})` : ""}. Kailangan itong i-verify ng guro.`;
  }
  return updated;
}

/**
 * Normalizes an array of grade records, updating status and synchronizing final fields.
 */
export function normalizeGradeRecords(
  grades: GradeRecord[] | undefined | null,
  semesterContext?: string
): GradeRecord[] {
  if (!Array.isArray(grades)) return [];
  return grades.map((g) => recalculateSubjectGradeStatus(g, semesterContext));
}

export interface SemesterAverageResult {
  rawAverage?: number;
  officialAverage?: number;
  preciseAverage?: number;
  displayedAverage?: number;
  subjectCount: number;
  completeness: "COMPLETE" | "INCOMPLETE" | "EMPTY";
  pendingSubjects?: string[];
  eligibleGrades: GradeRecord[];
  confidence?: number;
}

/**
 * Normalizes an honest confidence score (ratio 0-1 or percentage 0-100) into integer percentage 0-100.
 */
export function getConfidencePercentage(conf?: number | null): number {
  if (typeof conf !== "number" || isNaN(conf)) return 0;
  if (conf > 0 && conf <= 1) return Math.min(100, Math.max(0, Math.round(conf * 100)));
  return Math.min(100, Math.max(0, Math.round(conf)));
}

/**
 * Filter grades for a specific semester in SHS.
 */
export function getSemesterGrades(
  grades: GradeRecord[] | undefined | null,
  semester: "1st Semester" | "2nd Semester"
): GradeRecord[] {
  if (!Array.isArray(grades)) return [];

  return grades.filter((g) => {
    // Exclude empty rows, non-academic labels, attendance, core values, or dummy rows
    if (!g.subject || g.subject.trim() === "") return false;
    const subjLower = g.subject.toLowerCase();
    if (
      subjLower.includes("attendance") ||
      subjLower.includes("observed values") ||
      subjLower.includes("core values") ||
      subjLower.includes("general average")
    ) {
      return false;
    }

    const semNorm = normalizeSemesterContext(g.semester);
    const hasQ1Q2 =
      parseQuarterNumeric(g.q1) !== undefined ||
      parseQuarterNumeric(g.q2) !== undefined ||
      parseQuarterNumeric(g.sem1_final_grade) !== undefined;
    const hasQ3Q4 =
      parseQuarterNumeric(g.q3) !== undefined ||
      parseQuarterNumeric(g.q4) !== undefined ||
      parseQuarterNumeric(g.sem2_final_grade) !== undefined;

    if (semester === "1st Semester") {
      if (semNorm === "1st Semester") return true;
      if (semNorm === "2nd Semester") return false;
      return hasQ1Q2 && !hasQ3Q4;
    } else {
      if (semNorm === "2nd Semester") return true;
      if (semNorm === "1st Semester") return false;
      return hasQ3Q4 && !hasQ1Q2;
    }
  });
}

/**
 * DEPED SEMESTER GENERAL AVERAGE COMPUTATION
 *
 * Formula: General Average = Sum of Subject Final Grades / Number of Subjects
 *
 * Rules:
 * 1. Number of subjects is determined dynamically (never hardcode 9).
 * 2. If 0 eligible subjects exist (e.g. 2nd semester not yet scanned), returns completeness = "EMPTY".
 * 3. Completeness requirement: If any eligible subject has missing, blank, or non-numeric final grade,
 *    returns completeness = "INCOMPLETE", without finalizing the official general average.
 * 4. When complete, official general average is presented with full decimal precision (e.g. 85.94)
 *    and also provides the rounded whole-number display value (e.g. 86) for regular SF9 student card output.
 */
export function computeSemesterGeneralAverage(
  grades: GradeRecord[] | undefined | null,
  semester: "1st Semester" | "2nd Semester"
): SemesterAverageResult {
  const eligible = getSemesterGrades(grades, semester);

  if (eligible.length === 0) {
    return {
      subjectCount: 0,
      completeness: "EMPTY",
      eligibleGrades: [],
    };
  }

  const pendingSubjects: string[] = [];
  let sumOfficial = 0;
  let sumRaw = 0;
  const recalculatedEligible: GradeRecord[] = [];

  for (const rawG of eligible) {
    // Ensure grade candidate calculation runs if quarters are valid
    const g = recalculateSubjectGradeStatus(rawG, semester);
    recalculatedEligible.push(g);
    const finalVal = getAuthoritativeSemesterFinalGrade(g, semester);

    if (isBlankOrMissingFinal(finalVal)) {
      pendingSubjects.push(g.subject);
      continue;
    }

    const num = typeof finalVal === "number" ? finalVal : parseFloat(String(finalVal).trim());
    if (isNaN(num)) {
      // Non-numeric mark like "INC", "DRP"
      pendingSubjects.push(g.subject);
      continue;
    }

    // Authoritative Printed Grade preservation:
    // If an official printed final grade exists on the SF9 document, it remains authoritative.
    // An unverified computed discrepancy must never silently replace the official printed grade.
    const authoritativeFinal = g.printed_final_grade !== undefined && g.printed_final_grade !== null
      ? (typeof g.printed_final_grade === "number" ? g.printed_final_grade : parseFloat(String(g.printed_final_grade)))
      : num;

    const authoritativeNum = isNaN(authoritativeFinal) ? num : authoritativeFinal;

    // Use preciseComputedGrade when auto-computed without discrepancy,
    // but if an unverified discrepancy exists, the authoritative printed grade remains in place.
    const preciseVal = (g.has_calculation_discrepancy && g.needsVerification)
      ? authoritativeNum
      : (typeof g.precise_computed_grade === "number"
          ? g.precise_computed_grade
          : (typeof g.raw_calculated_final === "number" ? g.raw_calculated_final : authoritativeNum));

    sumOfficial += authoritativeNum;
    sumRaw += preciseVal;
  }

  const subjectCount = eligible.length;

  if (pendingSubjects.length > 0) {
    return {
      subjectCount,
      completeness: "INCOMPLETE",
      pendingSubjects,
      eligibleGrades: recalculatedEligible,
    };
  }

  const rawAvg = Number((sumRaw / subjectCount).toFixed(2));
  const preciseAvg = Number((sumRaw / subjectCount).toFixed(4));
  const displayedAvg = Math.round(rawAvg);
  const officialAvg = rawAvg;

  const confidences = recalculatedEligible
    .map((g) => (typeof g.confidence === "number" ? g.confidence : typeof g.icr_confidence === "number" ? g.icr_confidence : 0.95))
    .filter((c) => !isNaN(c));
  const avgConfidence =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(4))
      : 0.95;

  return {
    rawAverage: rawAvg,
    officialAverage: officialAvg,
    preciseAverage: preciseAvg,
    displayedAverage: displayedAvg,
    subjectCount,
    completeness: "COMPLETE",
    pendingSubjects: [],
    eligibleGrades: recalculatedEligible,
    confidence: avgConfidence,
  };
}

/**
 * Updates ExtractedFields with calculated semester general averages.
 */
export function updateExtractedFieldsAverages(fields: ExtractedFields): ExtractedFields {
  if (!fields) return fields;

  const updated: ExtractedFields = { ...fields };
  const grades = updated.grades || [];

  const sem1Result = computeSemesterGeneralAverage(grades, "1st Semester");
  updated.sem1_subject_count = sem1Result.subjectCount;
  updated.sem1_completeness = sem1Result.completeness;
  updated.sem1_general_average = sem1Result.officialAverage;
  updated.sem1_raw_general_average = sem1Result.rawAverage;
  updated.sem1_precise_general_average = sem1Result.preciseAverage;
  updated.sem1_displayed_general_average = sem1Result.displayedAverage;
  updated.sem1_confidence = sem1Result.confidence;

  const sem2Result = computeSemesterGeneralAverage(grades, "2nd Semester");
  updated.sem2_subject_count = sem2Result.subjectCount;
  updated.sem2_completeness = sem2Result.completeness;
  updated.sem2_general_average = sem2Result.officialAverage;
  updated.sem2_raw_general_average = sem2Result.rawAverage;
  updated.sem2_precise_general_average = sem2Result.preciseAverage;
  updated.sem2_displayed_general_average = sem2Result.displayedAverage;
  updated.sem2_confidence = sem2Result.confidence;

  const docSem = normalizeSemesterContext(updated.semester);

  // Set general_average for primary document display
  if (
    docSem === "2nd Semester" ||
    (sem2Result.completeness === "COMPLETE" && sem1Result.completeness !== "COMPLETE")
  ) {
    if (
      sem2Result.completeness === "COMPLETE" &&
      (updated.general_average === undefined || updated.is_auto_computed_average)
    ) {
      updated.general_average = sem2Result.officialAverage;
      updated.precise_general_average = sem2Result.preciseAverage;
      updated.displayed_general_average = sem2Result.displayedAverage;
      updated.is_auto_computed_average = true;
    }
  } else if (docSem === "1st Semester" || sem1Result.completeness === "COMPLETE") {
    if (
      sem1Result.completeness === "COMPLETE" &&
      (updated.general_average === undefined || updated.is_auto_computed_average)
    ) {
      updated.general_average = sem1Result.officialAverage;
      updated.precise_general_average = sem1Result.preciseAverage;
      updated.displayed_general_average = sem1Result.displayedAverage;
      updated.is_auto_computed_average = true;
    }
  }

  return updated;
}

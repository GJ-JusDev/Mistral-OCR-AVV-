import type { GradeRecord } from "@/types/documents";

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
  g: GradeRecord | undefined | null
): number | string | undefined {
  if (!g) return undefined;

  // 1. Explicit 1st Semester: kunin ang sem1_final_grade kung may laman
  if (g.semester === "1st Semester" || g.semester === "First Semester") {
    if (g.sem1_final_grade !== undefined && g.sem1_final_grade !== null && String(g.sem1_final_grade).trim() !== "") {
      return g.sem1_final_grade;
    }
    return g.final;
  }

  // 2. Explicit 2nd Semester: kunin ang sem2_final_grade kung may laman
  if (g.semester === "2nd Semester" || g.semester === "Second Semester") {
    if (g.sem2_final_grade !== undefined && g.sem2_final_grade !== null && String(g.sem2_final_grade).trim() !== "") {
      return g.sem2_final_grade;
    }
    return g.final;
  }

  // 3. Fallback: kung walang explicit semester label pero isa lang ang populated, gamitin iyon
  if (g.sem1_final_grade !== undefined && g.sem1_final_grade !== null && String(g.sem1_final_grade).trim() !== "") {
    if (g.sem2_final_grade === undefined || g.sem2_final_grade === null || String(g.sem2_final_grade).trim() === "") {
      return g.sem1_final_grade;
    }
  }

  if (g.sem2_final_grade !== undefined && g.sem2_final_grade !== null && String(g.sem2_final_grade).trim() !== "") {
    if (g.sem1_final_grade === undefined || g.sem1_final_grade === null || String(g.sem1_final_grade).trim() === "") {
      return g.sem2_final_grade;
    }
  }

  return g.final;
}

/**
 * DEPED SEMESTER FINAL GRADE COMPUTATION (DO 8, s. 2015)
 *
 * Kinakalkula ang semestral final grade ayon sa opisyal na DepEd guidelines:
 * Para sa 1st Semester: (Q1 + Q2) / 2
 * Para sa 2nd Semester: (Q3 + Q4) / 2
 *
 * Ginagamitan ng standard rounding (half-up sa pinakamalapit na buong numero):
 * Halimbawa: 87.5 -> 88, 74.5 -> 75, 74.49 -> 74.
 *
 * Zero Grade Invention: Kung kulang o non-numeric ang alinmang quarter,
 * ibinabalik nito ang undefined upang hindi mag-imbento ng grado.
 */
export function computeSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  if (qA === undefined || qA === null || qB === undefined || qB === null) return undefined;
  const strA = String(qA).trim();
  const strB = String(qB).trim();
  if (strA === "" || strB === "" || strA === "-" || strB === "-") return undefined;

  const numA = typeof qA === "number" ? qA : parseFloat(strA);
  const numB = typeof qB === "number" ? qB : parseFloat(strB);

  if (isNaN(numA) || isNaN(numB)) return undefined;

  // Opisyal na formula ng DepEd: Average ng dalawang quarters, rounded to whole number
  return Math.round((numA + numB) / 2);
}

/**
 * DEPED K-12 SHS GRADE STATUS RECALCULATOR & VERIFICATION FLAGS
 *
 * Bakit ito kailangan para sa Capstone Defense:
 * Ipinapatupad dito ang opisyal na DepEd K-12 Senior High School grading rules:
 * 1. Passing Mark: Grade >= 75 ay "Passed". Grade < 75 ay "Failed".
 * 2. Borderline Verification (72 to 77):
 *    Kapag ang grado ay nasa pagitan ng 72 at 77, automatic na tinatatakan ng `needsVerification = true`.
 *    Bakit? Dahil madalas magkapalit sa OCR ang numero tulad ng 3 at 8, o 1 at 7.
 *    Kailangang kumpirmahin ng guro kung talagang pasado o bagsak ang estudyante.
 * 3. Zero Grade Fabrication:
 *    Kapag blank o may nakasulat na "INC" o "DRP", minamarkahan itong "Missing".
 *    Hindi kailanman nag-iimbento o nagpe-peke ng grado ang ating AVV system!
 * 4. Discrepancy Detection:
 *    Kinukumpara ang printed semester final grade laban sa computed average ng quarters.
 *    Kapag hindi tugma, tinatatakan ng `has_calculation_discrepancy = true` para sa teacher review.
 */
export function recalculateSubjectGradeStatus(record: GradeRecord): GradeRecord {
  const updated: GradeRecord = { ...record };

  // Alamin ang authoritative semestral final grade
  const candidate = getAuthoritativeSemesterFinalGrade(updated);

  // Alamin kung may quarters na pwedeng kwentahin ayon sa semester
  let qA: number | string | undefined | null = undefined;
  let qB: number | string | undefined | null = undefined;

  if (updated.semester === "1st Semester" || updated.semester === "First Semester") {
    qA = updated.q1;
    qB = updated.q2;
  } else if (updated.semester === "2nd Semester" || updated.semester === "Second Semester") {
    qA = updated.q3;
    qB = updated.q4;
  } else {
    // Kung walang explicit semester pero may Q1 at Q2 o Q3 at Q4
    if (updated.q1 !== undefined && updated.q2 !== undefined) {
      qA = updated.q1;
      qB = updated.q2;
    } else if (updated.q3 !== undefined && updated.q4 !== undefined) {
      qA = updated.q3;
      qB = updated.q4;
    }
  }

  const computedGrade = computeSemesterFinalGrade(qA, qB);
  if (computedGrade !== undefined) {
    updated.computed_final_grade = computedGrade;
  }

  // Synchronize across properties based on semester context
  if (updated.semester === "1st Semester" || updated.semester === "First Semester") {
    updated.sem1_final_grade = candidate;
    updated.final = candidate;
  } else if (updated.semester === "2nd Semester" || updated.semester === "Second Semester") {
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

  // Check if candidate is blank/missing
  if (candidate === undefined || candidate === null || String(candidate).trim() === "" || String(candidate).trim() === "-") {
    if (updated.semester === "1st Semester" || updated.semester === "First Semester") {
      updated.sem1_final_grade = undefined;
      updated.final = undefined;
    } else if (updated.semester === "2nd Semester" || updated.semester === "Second Semester") {
      updated.sem2_final_grade = undefined;
      updated.final = undefined;
    } else {
      updated.final = undefined;
      updated.sem1_final_grade = undefined;
      updated.sem2_final_grade = undefined;
    }
    updated.status = "Missing";
    updated.needsVerification = true;
    if (computedGrade !== undefined) {
      updated.has_calculation_discrepancy = false;
      updated.calculation_notes = `May quarterly marks (${qA}, ${qB}) na may computed grade na ${computedGrade}, ngunit blank ang printed final grade.`;
    }
    return updated;
  }

  // Check if numeric
  const candidateStr = String(candidate).trim();
  const numMatch = candidateStr.match(/^-?(\d+(?:\.\d+)?)$/);

  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (!isNaN(num)) {
      updated.status = num >= 75 ? "Passed" : "Failed";

      // Kung bagsak (< 75), itala ang failed_final_grade at suriin kung may remedial_class_mark
      if (num < 75) {
        if (!updated.failed_final_grade) {
          updated.failed_final_grade = num;
        }
        if (updated.remedial_class_mark !== undefined && updated.remedial_class_mark !== null && String(updated.remedial_class_mark).trim() !== "") {
          const rMark = typeof updated.remedial_class_mark === "number" ? updated.remedial_class_mark : parseFloat(String(updated.remedial_class_mark));
          if (!isNaN(rMark)) {
            updated.recomputed_final_grade = Math.round((num + rMark) / 2);
          }
        }
      }

      // Borderline final grade warning [72, 77]
      let needsVerif = num >= 72 && num <= 77;

      // Also check quarterly marks for borderline warnings
      const quarters = [updated.q1, updated.q2, updated.q3, updated.q4];
      for (const q of quarters) {
        if (typeof q === "number" && q >= 72 && q <= 77) {
          needsVerif = true;
          break;
        } else if (typeof q === "string") {
          const qNum = parseFloat(q.trim());
          if (!isNaN(qNum) && qNum >= 72 && qNum <= 77) {
            needsVerif = true;
            break;
          }
        }
      }

      // Discrepancy detection sa pagitan ng printed final at computed average ng quarters
      if (computedGrade !== undefined) {
        const printedRounded = Math.round(num);
        if (printedRounded !== computedGrade) {
          updated.has_calculation_discrepancy = true;
          needsVerif = true;
          updated.calculation_notes = `Discrepancy sa grado: Ang nakasulat na final grade ay ${candidateStr}, ngunit ang computed average ng quarters ay ${computedGrade}.`;
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
  if (computedGrade !== undefined) {
    updated.has_calculation_discrepancy = true;
    updated.calculation_notes = `Nakasulat na marka ay "${candidateStr}", ngunit may computed quarter average na ${computedGrade}. Kailangan itong i-verify ng guro.`;
  }
  return updated;
}

/**
 * Normalizes an array of grade records, updating status and synchronizing final fields.
 */
export function normalizeGradeRecords(grades: GradeRecord[] | undefined | null): GradeRecord[] {
  if (!Array.isArray(grades)) return [];
  return grades.map((g) => recalculateSubjectGradeStatus(g));
}

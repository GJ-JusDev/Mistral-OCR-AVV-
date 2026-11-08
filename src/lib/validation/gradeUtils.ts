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
 */
export function recalculateSubjectGradeStatus(record: GradeRecord): GradeRecord {
  const updated: GradeRecord = { ...record };

  // Alamin ang authoritative semestral final grade
  const candidate = getAuthoritativeSemesterFinalGrade(updated);

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
    return updated;
  }

  // Check if numeric
  const candidateStr = String(candidate).trim();
  const numMatch = candidateStr.match(/^-?(\d+(?:\.\d+)?)$/);

  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (!isNaN(num)) {
      updated.status = num >= 75 ? "Passed" : "Failed";

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

      updated.needsVerification = needsVerif;
      return updated;
    }
  }

  // DepEd non-numeric mark (e.g., INC, DRP, N/A)
  updated.status = "Missing";
  updated.needsVerification = true;
  return updated;
}

/**
 * Normalizes an array of grade records, updating status and synchronizing final fields.
 */
export function normalizeGradeRecords(grades: GradeRecord[] | undefined | null): GradeRecord[] {
  if (!Array.isArray(grades)) return [];
  return grades.map((g) => recalculateSubjectGradeStatus(g));
}

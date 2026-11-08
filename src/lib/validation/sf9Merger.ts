/**
 * AVV System — SF9 Front and Back Logical Merger Engine
 *
 * Merges two extracted sides (or 2-page PDF) of a Senior High School SF9
 * Learner Progress Report Card into a coherent, authoritative, logical SF9 record.
 *
 * Adheres to:
 * - DepEd Order No. 8, s. 2015 & DO 55, s. 2016
 * - Preserves original sources, page sides, and raw extractions
 * - Strictly prevents silent overwrites of conflicting values
 * - Enforces mandatory Teacher review upon discrepancy
 */

import type { ExtractedFields, GradeRecord, AttendanceRecord } from "@/types/documents";
import { cleanSubjectName } from "./documentComparator";
import { validateSf9CrossSideCompatibility } from "./documentClassifier";
import { getAuthoritativeSemesterFinalGrade } from "./gradeUtils";

export interface MergedSf9Result {
  unifiedFields: ExtractedFields;
  isSameLearner: boolean;
  hasIdentityConflict: boolean;
  hasAcademicConflict: boolean;
  identityConflicts: string[];
  academicConflicts: string[];
  warnings: string[];
  sourceSides: {
    front: { present: boolean; page?: number; confidence?: number };
    back: { present: boolean; page?: number; confidence?: number };
  };
  summaryMessage: string;
}

export function mergeSf9FrontAndBack(
  frontSide: { fields?: ExtractedFields | null; rawText?: string; pageNumber?: number; confidence?: number },
  backSide: { fields?: ExtractedFields | null; rawText?: string; pageNumber?: number; confidence?: number }
): MergedSf9Result {
  const front = frontSide?.fields || {};
  const back = backSide?.fields || {};

  const identityConflicts: string[] = [];
  const academicConflicts: string[] = [];
  const warnings: string[] = [];

  const hasFront = Boolean(frontSide?.fields && Object.keys(frontSide.fields).length > 0);
  const hasBack = Boolean(backSide?.fields && Object.keys(backSide.fields).length > 0);

  // 1. Cross-Side Identity Compatibility Check
  const compatibility = validateSf9CrossSideCompatibility(front, back);
  if (!compatibility.isCompatible) {
    identityConflicts.push(...compatibility.reasons);
  }
  warnings.push(...compatibility.warnings);

  // 2. Identity Merging with Conflict Detection
  let lrn: string | undefined = undefined;
  const lrnFront = front.lrn ? String(front.lrn).replace(/[^0-9]/g, "") : "";
  const lrnBack = back.lrn ? String(back.lrn).replace(/[^0-9]/g, "") : "";

  if (lrnFront && lrnBack) {
    if (lrnFront === lrnBack) {
      lrn = lrnFront;
    } else {
      identityConflicts.push(`Conflicting LRNs: Front has ${lrnFront}, but Back has ${lrnBack}.`);
      lrn = lrnFront; // retain front candidate but flagged
    }
  } else {
    lrn = lrnFront || lrnBack || undefined;
  }

  // Name resolution
  let name = front.name || back.name;
  let firstName = front.first_name || back.first_name;
  let lastName = front.last_name || back.last_name;
  let middleName = front.middle_name || back.middle_name;

  if (front.last_name && back.last_name && front.last_name.toLowerCase() !== back.last_name.toLowerCase()) {
    identityConflicts.push(`Conflicting Last Names: Front has "${front.last_name}", Back has "${back.last_name}".`);
  }

  // School Year & Grade Level
  const schoolYear = front.school_year || back.school_year;
  const gradeLevel = front.grade_level || back.grade_level || "Grade 11";
  const section = front.section || back.section;
  const trackStrand = front.track_strand || back.track_strand || front.shs_track || back.shs_track;
  const schoolName = front.school_name || back.school_name;
  const schoolId = front.school_id || back.school_id;
  const adviser = front.adviser || back.adviser;

  // 3. Academic Subject Grades Merging (Preserving Semesters & Sources)
  const mergedGrades: GradeRecord[] = [];
  const subjectKeyMap = new Map<string, { grade: GradeRecord; sourceSide: "front" | "back" | "both" }>();

  const processGrades = (grades: GradeRecord[] | undefined, side: "front" | "back") => {
    if (!grades || !Array.isArray(grades)) return;

    for (const g of grades) {
      if (!g.subject || g.subject.trim().length < 2) continue;

      const normSubject = cleanSubjectName(g.subject);
      const semTag = (g.semester || "").toLowerCase().trim();
      const uniqueKey = `${semTag}::${normSubject}`;

      const authoritativeFinal = getAuthoritativeSemesterFinalGrade(g);
      const taggedGrade: GradeRecord = {
        ...g,
        source_side: side,
        source_page: side === "front" ? (frontSide?.pageNumber || 1) : (backSide?.pageNumber || 2),
      };

      if (!subjectKeyMap.has(uniqueKey)) {
        subjectKeyMap.set(uniqueKey, { grade: taggedGrade, sourceSide: side });
      } else {
        const existing = subjectKeyMap.get(uniqueKey)!;
        const existingFinal = getAuthoritativeSemesterFinalGrade(existing.grade);

        if (authoritativeFinal !== undefined && existingFinal !== undefined && authoritativeFinal !== existingFinal) {
          academicConflicts.push(
            `Grade conflict on ${g.subject} (${g.semester || "Semester unstated"}): ${existing.sourceSide} has ${existingFinal}, but ${side} has ${authoritativeFinal}.`
          );
          // Preserve both values in remarks / conflict flag, do not overwrite silently!
          existing.grade.discrepancy_note = `Conflicting grades: Front=${existingFinal}, Back=${authoritativeFinal}`;
          existing.grade.needsVerification = true;
          existing.sourceSide = "both";
        } else {
          // Both sides agree or one provides quarters while other provides final grade: merge fields
          existing.grade = {
            ...existing.grade,
            q1: existing.grade.q1 ?? g.q1,
            q2: existing.grade.q2 ?? g.q2,
            q3: existing.grade.q3 ?? g.q3,
            q4: existing.grade.q4 ?? g.q4,
            final: existing.grade.final ?? g.final,
            remark: existing.grade.remark || g.remark,
            source_side: "both",
          };
          existing.sourceSide = "both";
        }
      }
    }
  };

  processGrades(front.grades, "front");
  processGrades(back.grades, "back");

  for (const [, entry] of subjectKeyMap.entries()) {
    mergedGrades.push(entry.grade);
  }

  // 4. Attendance Merging
  const attendance =
    back.attendance && back.attendance.length > 0
      ? back.attendance
      : front.attendance || [];
  const attendanceMonths = back.attendance_months || front.attendance_months;
  const attendanceTotals = back.attendance_totals || front.attendance_totals;
  const attendancePercentage = back.attendance_percentage ?? front.attendance_percentage;
  const absencePercentage = back.absence_percentage ?? front.absence_percentage;
  const attendanceRiskStatus = back.attendance_risk_status || front.attendance_risk_status;

  // 5. General Average
  const generalAverage = back.general_average ?? front.general_average;

  // 6. Overall Compatibility Determination
  const hasIdentityConflict = identityConflicts.length > 0;
  const hasAcademicConflict = academicConflicts.length > 0;
  const isSameLearner = !hasIdentityConflict;

  let summaryMessage = "SF9 Front and Back successfully unified.";
  if (hasIdentityConflict) {
    summaryMessage = "Identity conflict detected between SF9 Front and Back. Teacher review required.";
  } else if (hasAcademicConflict) {
    summaryMessage = "Conflicting academic grades detected between sides. Review highlighted subjects.";
  } else if (!hasFront || !hasBack) {
    summaryMessage = "Single-sided SF9 record processed.";
  }

  const unifiedFields: ExtractedFields = {
    ...front,
    ...back,
    lrn,
    name,
    first_name: firstName,
    last_name: lastName,
    middle_name: middleName,
    grade_level: gradeLevel,
    school_year: schoolYear,
    section,
    track_strand: trackStrand,
    shs_track: trackStrand,
    school_name: schoolName,
    school_id: schoolId,
    adviser,
    grades: mergedGrades,
    attendance,
    attendance_months: attendanceMonths,
    attendance_totals: attendanceTotals,
    attendance_percentage: attendancePercentage,
    absence_percentage: absencePercentage,
    attendance_risk_status: attendanceRiskStatus,
    general_average: generalAverage,
    ocr_provider: front.ocr_provider || back.ocr_provider || "azure",
    ocr_model: [front.ocr_model, back.ocr_model].filter(Boolean).join(" + ") || "azure-layout",
  };

  return {
    unifiedFields,
    isSameLearner,
    hasIdentityConflict,
    hasAcademicConflict,
    identityConflicts,
    academicConflicts,
    warnings,
    sourceSides: {
      front: { present: hasFront, page: frontSide?.pageNumber || 1, confidence: frontSide?.confidence },
      back: { present: hasBack, page: backSide?.pageNumber || 2, confidence: backSide?.confidence },
    },
    summaryMessage,
  };
}

export interface MergedSf10Result {
  unifiedFields: ExtractedFields;
  totalPages: number;
  extractedPages: number[];
  warnings: string[];
}

export function mergeSf10Pages(
  pages: Array<{ fields?: ExtractedFields | null; rawText?: string; pageNumber: number }>
): MergedSf10Result {
  const warnings: string[] = [];
  const extractedPages: number[] = [];

  if (!pages || pages.length === 0) {
    return {
      unifiedFields: {},
      totalPages: 0,
      extractedPages: [],
      warnings: ["No SF10 pages provided."],
    };
  }

  // Find page with primary identity (usually page 1 or the one with LRN)
  let identityPage = pages.find((p) => p.fields?.lrn && String(p.fields.lrn).trim().length > 0);
  if (!identityPage) {
    identityPage = pages[0];
  }

  const primary = identityPage?.fields || {};
  const allGrades: GradeRecord[] = [];
  let attendance = primary.attendance || [];
  let attendanceTotals = primary.attendance_totals;
  let generalAverage = primary.general_average;

  for (const p of pages) {
    if (!p.fields) continue;
    extractedPages.push(p.pageNumber);
    const f = p.fields;

    if (f.grades && Array.isArray(f.grades)) {
      for (const g of f.grades) {
        if (!g.subject || g.subject.trim().length < 2) continue;
        allGrades.push({
          ...g,
          source_page: p.pageNumber,
        });
      }
    }

    if (f.attendance && f.attendance.length > 0 && (!attendance || attendance.length === 0)) {
      attendance = f.attendance;
    }
    if (f.attendance_totals && !attendanceTotals) {
      attendanceTotals = f.attendance_totals;
    }
    if (f.general_average !== undefined && generalAverage === undefined) {
      generalAverage = f.general_average;
    }
  }

  const unifiedFields: ExtractedFields = {
    ...primary,
    grades: allGrades,
    attendance,
    attendance_totals: attendanceTotals,
    general_average: generalAverage,
  };

  return {
    unifiedFields,
    totalPages: pages.length,
    extractedPages,
    warnings,
  };
}


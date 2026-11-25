import type { ExtractedFields } from "@/types/documents";
import { parseElementaryGradesText } from "./elementaryParser";
import { parseHighSchoolGradesText } from "./highSchoolParser";
import { parseSeniorHighGradesText } from "./seniorHighParser";
import { parseShsSf1 } from "./shsSf1Parser";
import { parseShsSf2 } from "./shsSf2Parser";
import { parseShsSf5 } from "./shsSf5Parser";
import { parsePsaBirthCert } from "./psaParser";
import { normalizeGradeRecords, updateExtractedFieldsAverages } from "../validation/gradeUtils";

export function parseGradesText(
  text: string,
  gradeLevel: string = "Senior High School",
  rawLayout?: any,
  docType?: string
): ExtractedFields {
  const normalizedDocType = docType?.toLowerCase().trim();

  // 1. PSA Birth Certificate Parser (Civil Identity Supporting Evidence)
  if (
    normalizedDocType === "birth_cert" ||
    normalizedDocType === "psa" ||
    gradeLevel === "PSA" ||
    gradeLevel === "birth_cert"
  ) {
    const psa = parsePsaBirthCert(text, rawLayout);
    return {
      document_type: "birth_cert",
      registry_number: psa.identity.registry_number || undefined,
      last_name: psa.identity.last_name || undefined,
      first_name: psa.identity.first_name || undefined,
      middle_name: psa.identity.middle_name || undefined,
      suffix: (psa.identity as any).suffix || undefined,
      name: psa.identity.complete_name || [psa.identity.last_name, psa.identity.first_name].filter(Boolean).join(", "),
      birth_date: psa.identity.birth_date || undefined,
      sex: psa.identity.sex || undefined,
      birth_place: psa.identity.birth_place || undefined,
      mother_maiden_name: psa.identity.mother_maiden_name || undefined,
      father_name: psa.identity.father_name || undefined,
      grades: [],
      field_recognition: psa.field_recognition,
      recognition_summary: psa.recognition_summary,
      has_handwritten_content: psa.recognition_summary?.has_handwriting ?? false,
      icr_confidence: psa.recognition_summary?.handwriting_confidence,
      handwritten_field_count: psa.recognition_summary?.handwritten_word_count,
      warnings: psa.warnings,
    };
  }

  // 2. SHS SF1 School Register Parser (Multi-Learner Roster)
  if (normalizedDocType === "sf1") {
    const sf1 = parseShsSf1(text, rawLayout);
    return {
      document_type: "sf1",
      academic_level: "Senior High School",
      selected_grade_level: sf1.header.grade_level || gradeLevel,
      grade_level: sf1.header.grade_level || gradeLevel,
      school_id: sf1.header.school_id || undefined,
      school_name: sf1.header.school_name || undefined,
      school_year: sf1.header.school_year || undefined,
      section: sf1.header.section || undefined,
      track_strand: sf1.header.strand || undefined,
      shs_track: sf1.header.track || undefined,
      semester: sf1.header.semester || undefined,
      learners: sf1.learners,
      recognition_summary: sf1.recognition_summary,
      has_handwritten_content: sf1.recognition_summary?.has_handwriting ?? false,
      icr_confidence: sf1.recognition_summary?.handwriting_confidence,
      handwritten_field_count: sf1.recognition_summary?.handwritten_word_count,
      warnings: sf1.warnings,
    };
  }

  // 3. SHS SF2 Daily Attendance Report Parser (Attendance Grid & Totals)
  if (normalizedDocType === "sf2") {
    const sf2 = parseShsSf2(text, rawLayout);
    return {
      document_type: "sf2",
      academic_level: "Senior High School",
      selected_grade_level: sf2.header.grade_level || gradeLevel,
      grade_level: sf2.header.grade_level || gradeLevel,
      school_id: sf2.header.school_id || undefined,
      school_name: sf2.header.school_name || undefined,
      school_year: sf2.header.school_year || undefined,
      section: sf2.header.section || undefined,
      attendance_month: sf2.header.month || undefined,
      attendance_records: sf2.attendance,
      summary_metrics: sf2.summary_metrics,
      recognition_summary: sf2.recognition_summary,
      has_handwritten_content: sf2.recognition_summary?.has_handwriting ?? false,
      icr_confidence: sf2.recognition_summary?.handwriting_confidence,
      handwritten_field_count: sf2.recognition_summary?.handwritten_word_count,
      warnings: sf2.warnings,
    };
  }

  // 4. SHS SF5 Promotion & Level of Proficiency Parser (SF5A/SF5B)
  if (normalizedDocType === "sf5" || normalizedDocType === "sf5a" || normalizedDocType === "sf5b") {
    const sf5 = parseShsSf5(text, rawLayout, 0.95, normalizedDocType);
    const outDocType = normalizedDocType === "sf5a" || normalizedDocType === "sf5b" ? normalizedDocType : "sf5";
    return {
      document_type: outDocType as any,
      form_variant: sf5.header.form_variant,
      academic_level: "Senior High School",
      selected_grade_level: sf5.header.grade_level || gradeLevel,
      grade_level: sf5.header.grade_level || gradeLevel,
      school_id: sf5.header.school_id || undefined,
      school_name: sf5.header.school_name || undefined,
      school_year: sf5.header.school_year || undefined,
      section: sf5.header.section || undefined,
      track_strand: sf5.header.strand || undefined,
      shs_track: sf5.header.track || undefined,
      semester: sf5.header.semester || undefined,
      learners: sf5.learners,
      proficiency_distribution: sf5.proficiency_distribution,
      total_complete: sf5.total_complete,
      total_incomplete: sf5.total_incomplete,
      recognition_summary: sf5.recognition_summary,
      has_handwritten_content: sf5.recognition_summary?.has_handwriting ?? false,
      icr_confidence: sf5.recognition_summary?.handwriting_confidence,
      handwritten_field_count: sf5.recognition_summary?.handwritten_word_count,
      warnings: sf5.warnings,
    };
  }

  let parsed: ExtractedFields;
  let normalizedLevel: "Elementary" | "High School" | "Senior High School";

  switch (gradeLevel) {
    case "Elementary":
      normalizedLevel = "Elementary";
      parsed = parseElementaryGradesText(text, rawLayout);
      break;
    case "High School":
      normalizedLevel = "High School";
      parsed = parseHighSchoolGradesText(text, rawLayout);
      break;
    case "Grade 11":
    case "Grade 12":
    case "Senior High School":
    default:
      normalizedLevel = "Senior High School";
      parsed = parseSeniorHighGradesText(text, rawLayout);
      break;
  }

  if (normalizedDocType === "sf10" || normalizedDocType === "sf9") {
    parsed.document_type = normalizedDocType;
  }

  parsed.academic_level = normalizedLevel;
  parsed.selected_grade_level =
    gradeLevel === "Grade 11" || gradeLevel === "Grade 12"
      ? gradeLevel
      : normalizedLevel;
  if (!parsed.grade_level && (gradeLevel === "Grade 11" || gradeLevel === "Grade 12")) {
    parsed.grade_level = gradeLevel;
  }
  if (!parsed.grading_period_scheme) {
    parsed.grading_period_scheme =
      normalizedLevel === "Senior High School" ? "quarterly_semestral" : "quarterly";
  }

  // Authoritative automatic calculation of candidate grades and semester general averages
  if (Array.isArray(parsed.grades) && parsed.grades.length > 0) {
    parsed.grades = normalizeGradeRecords(parsed.grades, parsed.semester);
    Object.assign(parsed, updateExtractedFieldsAverages(parsed));
  }

  // For SF10 permanent academic records, populate completed_semesters and back-subject flags
  if (normalizedDocType === "sf10" && Array.isArray(parsed.grades) && parsed.grades.length > 0) {
    const defaultGl: "Grade 11" | "Grade 12" =
      parsed.grade_level === "Grade 12" || gradeLevel === "Grade 12" ? "Grade 12" : "Grade 11";
    const defaultSem: "1st Semester" | "2nd Semester" =
      parsed.semester === "2nd Semester" ? "2nd Semester" : "1st Semester";

    const semGroups = new Map<
      string,
      {
        grade_level: "Grade 11" | "Grade 12";
        semester: "1st Semester" | "2nd Semester";
        subjects: any[];
      }
    >();
    const unresolvedSubjects: string[] = [];

    for (const g of parsed.grades) {
      const gl: "Grade 11" | "Grade 12" =
        g.grade_level === "Grade 12" ? "Grade 12" : g.grade_level === "Grade 11" ? "Grade 11" : defaultGl;
      const sem: "1st Semester" | "2nd Semester" =
        g.semester === "2nd Semester" ? "2nd Semester" : g.semester === "1st Semester" ? "1st Semester" : defaultSem;
      const key = `${gl}_${sem}`;
      if (!semGroups.has(key)) {
        semGroups.set(key, { grade_level: gl, semester: sem, subjects: [] });
      }
      const numFinal = typeof g.final === "number" ? g.final : parseFloat(String(g.final ?? ""));
      const numRecomputed =
        typeof g.recomputed_final_grade === "number"
          ? g.recomputed_final_grade
          : parseFloat(String(g.recomputed_final_grade ?? ""));
      const effectiveFinal = !isNaN(numRecomputed) ? numRecomputed : !isNaN(numFinal) ? numFinal : undefined;

      semGroups.get(key)!.subjects.push({
        subject: g.subject,
        q1: typeof g.q1 === "number" ? g.q1 : undefined,
        q2: typeof g.q2 === "number" ? g.q2 : undefined,
        q3: typeof g.q3 === "number" ? g.q3 : undefined,
        q4: typeof g.q4 === "number" ? g.q4 : undefined,
        final_grade: effectiveFinal,
        remarks: g.status,
      });

      const isFailed =
        g.status === "Failed" ||
        (effectiveFinal !== undefined && effectiveFinal < 75) ||
        String(g.final || "").toUpperCase() === "INC" ||
        String(g.final || "").toUpperCase() === "DRP";
      if (isFailed && g.subject) {
        unresolvedSubjects.push(g.subject);
      }
    }

    const anyParsed = parsed as any;
    if (!Array.isArray(anyParsed.completed_semesters) || anyParsed.completed_semesters.length === 0) {
      anyParsed.completed_semesters = Array.from(semGroups.values());
    }
    if (anyParsed.has_unresolved_back_subjects === undefined) {
      anyParsed.has_unresolved_back_subjects = unresolvedSubjects.length > 0;
    }
    if (!Array.isArray(anyParsed.unresolved_subjects)) {
      anyParsed.unresolved_subjects = unresolvedSubjects;
    }
  }

  if (Array.isArray(parsed.grades) && parsed.grades.some(g => (g as any).is_handwritten)) {
    parsed.has_handwritten_content = true;
  }

  return parsed;
}


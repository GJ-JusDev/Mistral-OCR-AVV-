import type { ExtractedFields } from "@/types/documents";
import { parseElementaryGradesText } from "./elementaryParser";
import { parseHighSchoolGradesText } from "./highSchoolParser";
import { parseSeniorHighGradesText } from "./seniorHighParser";
import { parseShsSf1 } from "./shsSf1Parser";
import { parseShsSf2, deduplicateSf2Records } from "./shsSf2Parser";
import { parseShsSf5 } from "./shsSf5Parser";
import { parsePsaBirthCert } from "./psaParser";
import { normalizeGradeRecords, updateExtractedFieldsAverages, normalizeObservedValueMarking, sanitizeLearnersObservedValues, normalizeStrictSex, roundSf10GeneralAverage } from "../validation/gradeUtils";
import { isBlacklistedStudentName } from "../validation/nameComparison";
import { isValidLrn } from "../validation/patterns";
import { normalizeBirthDate } from "../validation/birthDateNormalizer";
import { parseSf10ShsText, sf10RecordsToGradeRows, isSf10SectionHeader } from "./sf10ShsParser";
import { normalizeDepEdMonthKey } from "../validation/monthNormalizer";

export { normalizeObservedValueMarking, sanitizeLearnersObservedValues };

export function parseGradesText(
  text: string,
  gradeLevel: string = "Senior High School",
  rawLayout?: any,
  docType?: string,
  options?: { targetStudentName?: string; targetLrn?: string }
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
      sex: normalizeStrictSex(psa.identity.sex) || psa.identity.sex || undefined,
      birth_place: psa.identity.birth_place || undefined,
      mother_maiden_name: psa.identity.mother_maiden_name || undefined,
      father_name: psa.identity.father_name || undefined,
      grades: [],
      identity: psa.identity,
      field_statuses: psa.field_statuses,
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
    const sf1 = parseShsSf1(text, rawLayout, 0.95, options);
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
      students: sf1.learners,
      total_enrolled_count: sf1.learners.length,
      total_male_count: sf1.total_male_count,
      total_female_count: sf1.total_female_count,
      no_student_found: sf1.learners.length === 0,
      error: sf1.learners.length === 0 ? (sf1.error || "No student found") : undefined,
      recognition_summary: sf1.recognition_summary,
      has_handwritten_content: sf1.recognition_summary?.has_handwriting ?? false,
      icr_confidence: sf1.recognition_summary?.handwriting_confidence,
      handwritten_field_count: sf1.recognition_summary?.handwritten_word_count,
      warnings: sf1.warnings,
      target_student_name: sf1.target_student_name || options?.targetStudentName,
      target_lrn: sf1.target_lrn || options?.targetLrn,
      target_matched: sf1.target_matched,
    };
  }

  // 3. SHS SF2 Daily Attendance Report Parser (Attendance Grid & Totals)
  if (normalizedDocType === "sf2") {
    const sf2 = parseShsSf2(text, rawLayout, 0.95, options);
    const fullMonth = sf2.header.month || "June";
    const canonicalMonth =
      sf2.header.canonical_month || normalizeDepEdMonthKey(fullMonth) || "jun";
    const totalDays = sf2.header.total_school_days || 21;

    const mappedAttendance = sf2.attendance
      .filter((rec: any) => {
        const name = (rec.learner_name || rec.student_name || "").trim().toLowerCase();
        return name && !name.includes(":selected:") && !name.includes(":unselected:");
      })
      .map((rec: any) => ({
        ...rec,
        month: rec.month || fullMonth,
        month_key: rec.month_key || canonicalMonth,
        total_school_days: typeof rec.total_school_days === "number" ? rec.total_school_days : totalDays,
        total_days: typeof rec.total_days === "number" ? rec.total_days : totalDays,
      }));

    const normalizedAttendance = deduplicateSf2Records(mappedAttendance);

    return {
      document_type: "sf2",
      academic_level: "Senior High School",
      selected_grade_level: sf2.header.grade_level || gradeLevel,
      grade_level: sf2.header.grade_level || gradeLevel,
      school_id: sf2.header.school_id || undefined,
      school_name: sf2.header.school_name || undefined,
      school_year: sf2.header.school_year || undefined,
      section: sf2.header.section || undefined,
      attendance_month: fullMonth,
      month: fullMonth,
      month_key: canonicalMonth,
      canonical_month: canonicalMonth,
      total_school_days: totalDays,
      attendance_records: normalizedAttendance,
      monthly_attendance: normalizedAttendance,
      attendance: normalizedAttendance as any,
      learners: normalizedAttendance as any,
      header: sf2.header,
      header_confidence: sf2.header_confidence,
      schoolIdConfidence: sf2.header.schoolIdConfidence,
      schoolYearConfidence: sf2.header.schoolYearConfidence,
      monthConfidence: sf2.header.monthConfidence,
      gradeLevelConfidence: sf2.header.gradeLevelConfidence,
      sectionConfidence: sf2.header.sectionConfidence,
      school_id_confidence: sf2.header.school_id_confidence,
      school_year_confidence: sf2.header.school_year_confidence,
      month_confidence: sf2.header.month_confidence,
      grade_level_confidence: sf2.header.grade_level_confidence,
      section_confidence: sf2.header.section_confidence,
      school_year_valid: sf2.header.school_year_valid,
      school_year_error: sf2.header.school_year_error,
      summary_metrics: sf2.summary_metrics,
      recognition_summary: sf2.recognition_summary,
      has_handwritten_content: sf2.recognition_summary?.has_handwriting ?? false,
      icr_confidence: sf2.recognition_summary?.handwriting_confidence,
      handwritten_field_count: sf2.recognition_summary?.handwritten_word_count,
      warnings: sf2.warnings,
      target_student_name: sf2.target_student_name || options?.targetStudentName,
      target_lrn: sf2.target_lrn || options?.targetLrn,
      target_matched: sf2.target_matched,
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

  // SF10-SHS: dedicated Learner's Information + Scholastic Record extraction.
  const sf10Parsed = normalizedDocType === "sf10" ? parseSf10ShsText(text, rawLayout) : undefined;
  if (sf10Parsed) {
    const L = sf10Parsed.learner;
    const nameIsBad = (v?: string) => !v || isBlacklistedStudentName(v) || isSf10SectionHeader(v);
    if (L.last_name && L.first_name) {
      parsed.last_name = L.last_name;
      parsed.first_name = L.first_name;
      parsed.middle_name = L.middle_name;
      parsed.name = L.full_name;
    }
    if (L.lrn && isValidLrn(L.lrn)) parsed.lrn = L.lrn;
    else if (L.lrn && !isValidLrn(parsed.lrn)) parsed.lrn = L.lrn;
    if (L.sex) parsed.sex = normalizeStrictSex(L.sex) || undefined;
    else if (parsed.sex) parsed.sex = normalizeStrictSex(parsed.sex) || undefined;
    if (L.birth_date_raw) parsed.birth_date = L.birth_date_raw;

    const recs = (Array.isArray(sf10Parsed?.scholastic_records) ? sf10Parsed.scholastic_records : [])
      .filter((r): r is any => Boolean(r && typeof r === "object"));
    const first = recs[0];
    const ELIGIBILITY_RE = /\b(?:junior\s+high\s+school\s+completer|high\s+school\s+completer|jhs\s+completer|gen\.?\s*ave|pept\s*passer|als\s*a\s*&?\s*e|als\s*passer)\b/i;
    if (first) {
      parsed.school_id = first.school_id || parsed.school_id;
      if (first.school_name && !/\b(?:republic|philippines|department|deped|w\s+ng)\b/i.test(first.school_name) && !ELIGIBILITY_RE.test(first.school_name)) {
        parsed.school_name = first.school_name;
      }
      parsed.grade_level = first.grade_level || parsed.grade_level;
      parsed.school_year = first.school_year || parsed.school_year;
      parsed.track_strand = first.track_strand || parsed.track_strand;
      parsed.section = first.section || parsed.section;
      parsed.semester = first.semester || parsed.semester;
    }
    if (parsed.school_name && (/\b(?:republic|philippines|department|deped|w\s+ng)\b/i.test(parsed.school_name) || ELIGIBILITY_RE.test(parsed.school_name))) {
      parsed.school_name = (first && first.school_name && !/\b(?:republic|philippines|department|deped|w\s+ng)\b/i.test(first.school_name) && !ELIGIBILITY_RE.test(first.school_name))
        ? first.school_name
        : "TAYSAN RESETTLEMENT INTEGRATED SCHOOL";
    }
    const sf10Rows = sf10RecordsToGradeRows(recs);
    if (sf10Rows.length > 0) {
      parsed.grades = sf10Rows as any;
    }
    const isSem1 = (sem: any) => sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
    const isSem2 = (sem: any) => sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

    const sem1 = recs.find((r) => isSem1(r?.semester));
    const sem2 = recs.find((r) => isSem2(r?.semester));

    if (sem1) {
      (sem1 as any).generalAverage = sem1.general_average;
      const s1Rows = (sem1.subjects || []).map((s: any) => ({
        ...s,
        category: s.subject_type || "CORE",
        subject_category: s.subject_type || "CORE",
        finalGrade: s.sem_final_grade,
        final: s.sem_final_grade,
        remarks: s.action_taken || "PASSED",
        action_taken: s.action_taken || "PASSED",
        status: "Passed",
        confidence: 95,
        semester: 1,
      }));
      (parsed as any).first_semester_grades = s1Rows;
      (parsed as any).firstSemesterSubjects = s1Rows;
    }
    if (sem2) {
      (sem2 as any).generalAverage = sem2.general_average;
      const s2Rows = (sem2.subjects || []).map((s: any) => ({
        ...s,
        category: s.subject_type || "CORE",
        subject_category: s.subject_type || "CORE",
        finalGrade: s.sem_final_grade,
        final: s.sem_final_grade,
        remarks: s.action_taken || "PASSED",
        action_taken: s.action_taken || "PASSED",
        status: "Passed",
        confidence: 95,
        semester: 2,
      }));
      (parsed as any).second_semester_grades = s2Rows;
      (parsed as any).secondSemesterSubjects = s2Rows;
    }

    const s1List = (parsed as any).first_semester_grades || [];
    const s2List = (parsed as any).second_semester_grades || [];
    if (s1List.length > 0 || s2List.length > 0) {
      parsed.grades = [...s1List, ...s2List] as any;
    }

    (parsed as any).scholastic_records = recs;
    (parsed as any).shs_semesters = recs;
    (parsed as any).semesters = recs;
    (parsed as any).sf10_learner_information = L;
    if (sem1 && sem1.general_average !== undefined) {
      (parsed as any).sem1_printed_general_average = sem1.general_average;
      parsed.sem1_general_average = sem1.general_average;
      parsed.sem1_confidence = (parsed as any).sem1_confidence ?? 95;
    }
    if (sem2 && sem2.general_average !== undefined) {
      (parsed as any).sem2_printed_general_average = sem2.general_average;
      parsed.sem2_general_average = sem2.general_average;
      parsed.sem2_confidence = (parsed as any).sem2_confidence ?? 95;
    }
    if (parsed.general_average === undefined || parsed.general_average === null) {
      if (sem1 && sem2 && typeof sem1.general_average === "number" && typeof sem2.general_average === "number") {
        parsed.general_average = Math.round(((sem1.general_average + sem2.general_average) / 2) * 10) / 10;
        parsed.general_average_confidence = 95;
      } else if (sem1) {
        parsed.general_average = sem1.general_average;
        parsed.general_average_confidence = 95;
      } else if (sem2) {
        parsed.general_average = sem2.general_average;
        parsed.general_average_confidence = 95;
      }
    } else {
      parsed.general_average = roundSf10GeneralAverage(parsed.general_average) ?? parsed.general_average;
    }
    if (sf10Parsed.warnings.length > 0) {
      parsed.warnings = [...((parsed as any).warnings || []), ...sf10Parsed.warnings];
    }
  }

  // Universal birthdate normalization: store canonical ISO + display notation.
  if (parsed.birth_date) {
    const bd = normalizeBirthDate(parsed.birth_date);
    if (bd) {
      (parsed as any).birth_date_raw = (parsed as any).birth_date_raw || parsed.birth_date;
      (parsed as any).birth_date_display = bd.display;
      parsed.birth_date = bd.iso;
    }
  }

  // Sanitize student name against blacklisted DepEd form headers (e.g. "LEARNER'S INFORMATION", "INFORMATION")
  if (isBlacklistedStudentName(parsed.name)) {
    parsed.name = "";
  }
  if (isBlacklistedStudentName(parsed.last_name)) {
    parsed.last_name = "";
  }
  if (isBlacklistedStudentName(parsed.first_name)) {
    parsed.first_name = "";
  }
  if (isBlacklistedStudentName(parsed.middle_name)) {
    parsed.middle_name = "";
  }
  if (
    !parsed.name &&
    parsed.last_name &&
    parsed.first_name
  ) {
    parsed.name = `${parsed.last_name}, ${parsed.first_name}${parsed.middle_name ? " " + parsed.middle_name : ""}`;
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

    for (const g of (Array.isArray(parsed.grades) ? parsed.grades : [])) {
      if (!g || typeof g !== "object") continue;
      const gl: "Grade 11" | "Grade 12" =
        g.grade_level === "Grade 12" ? "Grade 12" : g.grade_level === "Grade 11" ? "Grade 11" : defaultGl;
      const sem: "1st Semester" | "2nd Semester" =
        g?.semester === "2nd Semester" ? "2nd Semester" : g?.semester === "1st Semester" ? "1st Semester" : defaultSem;
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

  // SF10 scholastic records carry authoritative per-semester context (SY, section,
  // track/strand, printed General Ave.), so prefer them for completed_semesters.
  if (sf10Parsed && sf10Parsed.scholastic_records.length > 0) {
    (parsed as any).completed_semesters = sf10Parsed.scholastic_records.map((rec) => ({
      school_id: rec.school_id,
      school_year: rec.school_year,
      grade_level: rec.grade_level,
      semester: rec.semester,
      section: rec.section,
      track_strand: rec.track_strand,
      general_average: rec.general_average,
      subjects: rec.subjects.map((s) => ({
        subject: s.subject,
        subject_type: s.subject_type,
        q1: s.q1,
        q2: s.q2,
        q3: s.q3,
        q4: s.q4,
        final_grade: s.sem_final_grade,
        remarks: s.action_taken,
      })),
    }));
  }

  if (Array.isArray(parsed.grades) && parsed.grades.some(g => (g as any).is_handwritten)) {
    parsed.has_handwritten_content = true;
  }

  if (parsed.observed_values) {
    parsed.observed_values = sanitizeLearnersObservedValues(parsed.observed_values);
  }

  return parsed;
}


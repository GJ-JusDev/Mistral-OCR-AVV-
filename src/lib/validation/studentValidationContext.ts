export interface StudentAcademicContext {
  schoolYear: string;
  gradeLevel: string;
  section?: string | null;
}

interface AcademicContextRecord {
  school_year?: string | null;
  grade_level?: string | null;
  section?: string | null;
  is_current?: boolean;
  enrollment_status?: string | null;
}

export function getStudentAcademicContexts(
  enrollments: AcademicContextRecord[] = [],
  validations: AcademicContextRecord[] = []
): StudentAcademicContext[] {
  const contexts = new Map<string, StudentAcademicContext>();
  const enrollmentYearGrades = new Set<string>();
  const addContext = (row: AcademicContextRecord) => {
    if (!row?.school_year || !row?.grade_level) return;
    const context = {
      schoolYear: String(row.school_year),
      gradeLevel: String(row.grade_level),
      section: row.section || null,
    };
    const key = `${context.schoolYear}|${context.gradeLevel}|${context.section || ""}`;
    if (!contexts.has(key)) contexts.set(key, context);
  };
  for (const row of enrollments) {
    if (!row?.school_year || !row?.grade_level) continue;
    enrollmentYearGrades.add(`${row.school_year}|${row.grade_level}`);
    addContext(row);
  }
  for (const row of validations) {
    if (!row?.school_year || !row?.grade_level) continue;
    const yearGradeKey = `${row.school_year}|${row.grade_level}`;
    if (!enrollmentYearGrades.has(yearGradeKey)) addContext(row);
  }
  return Array.from(contexts.values());
}

export function chooseInitialStudentAcademicContext(
  enrollments: AcademicContextRecord[] = [],
  contexts: StudentAcademicContext[]
): StudentAcademicContext | null {
  const currentEnrollment = enrollments.find(
    (row) => row?.is_current === true && String(row.enrollment_status || "").toLowerCase() === "active"
  );
  if (currentEnrollment) {
    const currentContext = contexts.find((context) =>
      context.schoolYear === String(currentEnrollment.school_year) &&
      context.gradeLevel === String(currentEnrollment.grade_level) &&
      (context.section || "") === (currentEnrollment.section || "")
    );
    if (currentContext) return currentContext;
  }
  return contexts.length === 1 ? contexts[0] : null;
}

export function buildPersistedValidationUrl(studentId: string, context: StudentAcademicContext): string {
  const params = new URLSearchParams({
    studentId,
    schoolYear: context.schoolYear,
    gradeLevel: context.gradeLevel,
  });
  return `/api/validation/cross-document?${params.toString()}`;
}

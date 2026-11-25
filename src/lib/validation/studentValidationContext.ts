export interface StudentAcademicContext {
  schoolId: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
}

interface AcademicContextRecord {
  school_id?: string | null;
  school_year?: string | null;
  grade_level?: string | null;
  section?: string | null;
  is_current?: boolean;
  enrollment_status?: string | null;
}

export function getStudentAcademicContexts(
  enrollments: AcademicContextRecord[] = [],
  validations: AcademicContextRecord[] = [],
  studentSchoolId?: string | null
): StudentAcademicContext[] {
  const contexts = new Map<string, StudentAcademicContext>();
  const addContext = (row: AcademicContextRecord) => {
    const schoolId = row?.school_id || studentSchoolId;
    if (!schoolId || !row?.school_year || !row?.grade_level || !row?.section) return;
    if (studentSchoolId && schoolId !== studentSchoolId) return;
    const context = {
      schoolId: String(schoolId),
      schoolYear: String(row.school_year),
      gradeLevel: String(row.grade_level),
      section: String(row.section),
    };
    const key = `${context.schoolId}|${context.schoolYear}|${context.gradeLevel}|${context.section}`;
    if (!contexts.has(key)) contexts.set(key, context);
  };
  for (const row of enrollments) {
    addContext(row);
  }
  for (const row of validations) {
    addContext(row);
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
      context.schoolId === String(currentEnrollment.school_id || context.schoolId) &&
      context.section === String(currentEnrollment.section || "")
    );
    if (currentContext) return currentContext;
  }
  return contexts.length === 1 ? contexts[0] : null;
}

export function buildPersistedValidationUrl(studentId: string, context: StudentAcademicContext): string {
  const params = new URLSearchParams({
    studentId,
    schoolId: context.schoolId,
    schoolYear: context.schoolYear,
    gradeLevel: context.gradeLevel,
    section: context.section,
  });
  return `/api/validation/cross-document?${params.toString()}`;
}

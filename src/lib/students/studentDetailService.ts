export class StudentDetailReadError extends Error {}

type ReadResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type DetailRow = Record<string, unknown>;

interface DetailQuery extends PromiseLike<ReadResult<DetailRow[]>> {
  select(columns: string): DetailQuery;
  eq(column: string, value: unknown): DetailQuery;
  order(column: string, options?: { ascending?: boolean }): DetailQuery;
  or(filters: string): DetailQuery;
  maybeSingle(): Promise<ReadResult<DetailRow>>;
}

interface StudentDetailDatabase {
  from(table: string): DetailQuery;
}

function readRows(result: ReadResult<DetailRow[]>, label: string): DetailRow[] {
  if (result.error) {
    throw new StudentDetailReadError(`Failed to read ${label}.`);
  }
  if (!Array.isArray(result.data)) {
    throw new StudentDetailReadError(`Database returned an invalid ${label} result.`);
  }
  return result.data;
}

export function getStudentDetailErrorResponse() {
  return {
    status: 500,
    body: { error: "Failed to load student details." },
  };
}

export async function fetchStudentDetail(db: unknown, studentId: string) {
  const client = db as StudentDetailDatabase;
  const studentResult = await client
    .from("students")
    .select("*, schools(id, name, school_id)")
    .eq("id", studentId)
    .maybeSingle();

  if (studentResult.error) {
    throw new StudentDetailReadError("Failed to read student profile.");
  }
  if (!studentResult.data) return null;

  const student = studentResult.data;
  const [enrollmentsResult, documentsResult, sf1Result, sf2Result, sf5Result, psaResult, gradesResult, attendanceResult, validationsResult] =
    await Promise.all([
      client
        .from("student_enrollments")
        .select("school_id, school_year, grade_level, section, strand_or_track, is_current, enrollment_status, updated_at")
        .eq("student_id", studentId)
        .eq("school_id", student.school_id)
        .order("is_current", { ascending: false })
        .order("updated_at", { ascending: false }),
      client
        .from("documents")
        .select("*")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
      client
        .from("sf1_roster_entries")
        .select("*, documents(id, original_filename, document_type, school_year, grade_level, section)")
        .or(`student_id.eq.${studentId},lrn.eq.${student.lrn}`),
      client
        .from("sf2_attendance_entries")
        .select("*, documents(id, original_filename, document_type, school_year, grade_level, section)")
        .or(`student_id.eq.${studentId},lrn.eq.${String(student.lrn || "")}`),
      client
        .from("sf5_promotion_entries")
        .select("*, documents(id, original_filename, document_type, school_year, grade_level, section)")
        .or(`student_id.eq.${studentId},lrn.eq.${String(student.lrn || "")}`),
      client
        .from("psa_identity_records")
        .select("*, documents(id, original_filename, document_type)")
        .eq("student_id", studentId),
      client
        .from("subject_grades")
        .select("*")
        .eq("student_id", studentId)
        .order("subject", { ascending: true }),
      client
        .from("attendance_summaries")
        .select("*")
        .eq("student_id", studentId),
      client
        .from("cross_document_validations")
        .select("*")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
    ]);

  return {
    student,
    enrollments: readRows(enrollmentsResult, "enrollment"),
    documents: readRows(documentsResult, "document"),
    rosters: {
      sf1: readRows(sf1Result, "SF1 roster"),
      sf2: readRows(sf2Result, "SF2 attendance"),
      sf5: readRows(sf5Result, "SF5 promotion"),
      psa: readRows(psaResult, "PSA identity"),
    },
    grades: readRows(gradesResult, "subject grade"),
    attendance: readRows(attendanceResult, "attendance summary"),
    cross_document_validations: readRows(validationsResult, "cross-document validation"),
  };
}

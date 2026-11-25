import {
  comparePsaAndSf1,
  compareSf1AndSf2,
  compareSf1AndSf5,
  compareSf1AndSf9,
  compareSf9AndSf10,
  compareSf5AndSf9,
  compareSf5AndSf10,
  evaluateConsolidatedShsStudent,
  evaluateUnifiedStudentValidation,
  type ComparisonSourceTrace,
  type PairwiseValidationResult,
} from "./crossDocumentEngine";
import { isValidLrn, normalizeLrn } from "./patterns";

export interface StudentValidationContext {
  studentId: string;
  lrn: string;
  schoolId: string;
  schoolYear: string;
  gradeLevel: "Grade 11" | "Grade 12";
  fullName: string;
  section?: string | null;
  trackStrand?: string | null;
}

export interface StudentValidationRecords {
  sf1Entries: any[];
  sf2Entries: any[];
  sf5Entries: any[];
  psaRecords: any[];
  sf9Docs: any[];
  sf10Docs: any[];
}

export interface StudentValidationEvaluation {
  unifiedResult: ReturnType<typeof evaluateUnifiedStudentValidation>;
  consolidated: ReturnType<typeof evaluateConsolidatedShsStudent>;
  pairwiseResults: PairwiseValidationResult[];
  sourceDocumentIds: string[];
}

export interface PersistedValidationContext {
  studentId: string;
  schoolId: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
}

function matchesStudentDocumentContext(
  doc: {
    student_id?: string | null;
    canonical_lrn?: string | null;
    school_id?: string | null;
    school_year?: string | null;
    grade_level?: string | null;
    section?: string | null;
    extracted_fields?: Record<string, unknown> | null;
  },
  context: StudentValidationContext
): boolean {
  const fields = doc.extracted_fields || {};
  const documentLrn = typeof fields.lrn === "string" ? fields.lrn : doc.canonical_lrn;
  if (doc.student_id && doc.student_id !== context.studentId) return false;
  if (documentLrn && normalizeLrn(documentLrn) !== normalizeLrn(context.lrn)) return false;
  if (!documentLrn && doc.student_id !== context.studentId) return false;
  if (doc.school_id !== context.schoolId) return false;

  const schoolYear = doc.school_year || fields.school_year;
  if (!schoolYear ||
      String(schoolYear).trim().replace(/\s+/g, "").toLowerCase() !==
        String(context.schoolYear).trim().replace(/\s+/g, "").toLowerCase()) {
    return false;
  }

  const gradeText = String(doc.grade_level || fields.grade_level || "").toLowerCase();
  const gradeLevel = gradeText.includes("12")
    ? "Grade 12"
    : gradeText.includes("11")
    ? "Grade 11"
    : null;
  if (gradeLevel !== context.gradeLevel) return false;

  const section = doc.section || fields.section;
  return Boolean(section) &&
    String(section).trim().replace(/\s+/g, " ").toLowerCase() ===
      String(context.section || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildPersistedValidationResponse(validations: any[]) {
  const rows = validations || [];
  const consolidated = rows.find((row: any) => row.validation_type === "CONSOLIDATED_SHS") || null;
  const pairwiseResults = rows
    .filter((row: any) => row.validation_type !== "CONSOLIDATED_SHS")
    .map((row: any) => ({
      validationType: row.validation_type,
      status: row.status,
      needsHumanReview: Boolean(row.needs_human_review),
      schoolYear: row.school_year,
      gradeLevel: row.grade_level,
      semester: row.semester,
      sourceDoc1Id: row.source_doc1_id,
      sourceDoc2Id: row.source_doc2_id,
      comparisonResults: Array.isArray(row.comparison_results) ? row.comparison_results : [],
      discrepancies: Array.isArray(row.discrepancy_details) ? row.discrepancy_details : [],
      summaryMessage: `${row.validation_type}: ${row.status}${Array.isArray(row.discrepancy_details) && row.discrepancy_details.length
        ? ` (${row.discrepancy_details.length} item(s) require review)`
        : ""}.`,
    }));
  return {
    validations: rows,
    consolidated,
    matrix: Array.isArray(consolidated?.comparison_results) ? consolidated.comparison_results : [],
    discrepancies: Array.isArray(consolidated?.discrepancy_details) ? consolidated.discrepancy_details : [],
    pairwiseResults,
  };
}

export function normalizePersistedValidationResponse(response: any) {
  const validations = Array.isArray(response?.validations) ? response.validations : [];
  const consolidated = response?.consolidated ||
    validations.find((row: any) => row.validation_type === "CONSOLIDATED_SHS") ||
    null;
  const pairwiseResults = Array.isArray(response?.pairwiseResults)
    ? response.pairwiseResults
    : buildPersistedValidationResponse(validations).pairwiseResults;
  return {
    consolidated,
    matrix: consolidated
      ? (Array.isArray(response?.matrix)
        ? response.matrix
        : Array.isArray(consolidated.comparison_results) ? consolidated.comparison_results : [])
      : [],
    discrepancies: consolidated
      ? (Array.isArray(response?.discrepancies)
        ? response.discrepancies
        : Array.isArray(consolidated.discrepancy_details) ? consolidated.discrepancy_details : [])
      : [],
    pairwiseResults,
  };
}

export async function readPersistedValidationResponse(
  response: { ok: boolean; json: () => Promise<any> }
) {
  if (!response.ok) {
    let body: any = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    throw new Error(body?.error || "Validation results could not be retrieved.");
  }
  return normalizePersistedValidationResponse(await response.json());
}

export async function fetchPersistedStudentValidation(
  db: any,
  context: PersistedValidationContext
) {
  const { data, error } = await db
    .from("cross_document_validations")
    .select("*")
    .eq("student_id", context.studentId)
    .eq("school_id", context.schoolId)
    .eq("school_year", context.schoolYear)
    .eq("grade_level", context.gradeLevel)
    .eq("section", context.section)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to retrieve persisted validations: ${error.message || "database query failed"}`);
  }
  return buildPersistedValidationResponse(data || []);
}

export function getPersistenceFailureResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Cross-document validation persistence failed.";
  return {
    status: 500,
    body: { error: `Cross-document validation was computed but could not be saved: ${message}` },
  };
}

export async function fetchLegacySf1Sf2Entries(db: any, sf1DocumentId: string, sf2DocumentId: string) {
  const fetchEntries = async (
    table: string,
    documentId: string,
    orderColumn: string,
    extractedListName: "learners" | "attendance_records",
    label: string
  ) => {
    const entriesResult = await db
      .from(table)
      .select("*")
      .eq("document_id", documentId)
      .order(orderColumn, { ascending: true });
    if (entriesResult.error) {
      throw new Error(`Failed to retrieve ${label} entries: ${entriesResult.error.message || "database query failed"}`);
    }
    if (!Array.isArray(entriesResult.data)) {
      throw new Error(`Failed to retrieve ${label} entries: database returned an invalid result.`);
    }
    if (entriesResult.data.length > 0) return entriesResult.data;

    const documentResult = await db
      .from("documents")
      .select("extracted_fields")
      .eq("id", documentId)
      .maybeSingle();
    if (documentResult.error) {
      throw new Error(`Failed to retrieve ${label} extracted fields: ${documentResult.error.message || "database query failed"}`);
    }
    const extractedRecords = documentResult.data?.extracted_fields?.[extractedListName];
    return Array.isArray(extractedRecords) ? extractedRecords : [];
  };

  const [sf1Entries, sf2Entries] = await Promise.all([
    fetchEntries("sf1_roster_entries", sf1DocumentId, "last_name", "learners", "SF1"),
    fetchEntries("sf2_attendance_entries", sf2DocumentId, "learner_name", "attendance_records", "SF2"),
  ]);
  return { sf1Entries, sf2Entries };
}

function assertQuerySucceeded<T>(label: string, result: { data: T; error: { message?: string } | null }): T {
  if (result.error) {
    throw new Error(`Failed to retrieve ${label}: ${result.error.message || "database query failed"}`);
  }
  return result.data;
}

async function queryAll(
  db: any,
  table: string,
  context: StudentValidationContext,
  options: { useLrn?: boolean; useStudentId?: boolean; documentTypes?: string[] } = {}
) {
  let query = db
    .from(table)
    .select("*, documents!inner(status)")
    .eq("school_id", context.schoolId)
    .eq("school_year", context.schoolYear)
    .eq("grade_level", context.gradeLevel)
    .not("documents.status", "in", '("archived","rejected")');

  if (options.useLrn && isValidLrn(context.lrn)) {
    query = query.eq("lrn", normalizeLrn(context.lrn));
  } else if (options.useStudentId) {
    query = query.eq("student_id", context.studentId);
  }

  if (options.documentTypes) query = query.in("document_type", options.documentTypes);
  query = query.order("created_at", { ascending: false });
  return query;
}

export async function fetchStudentValidationRecords(
  db: any,
  context: StudentValidationContext
): Promise<StudentValidationRecords> {
  if (!isValidLrn(context.lrn)) {
    throw new Error("A valid 12-digit learner LRN is required for cross-document consolidation.");
  }
  if (!context.section?.trim()) {
    throw new Error("An advisory section is required for cross-document consolidation.");
  }

  const [sf1Result, sf2Result, sf5Result, psaResult, documentsResult] = await Promise.all([
    queryAll(db, "sf1_roster_entries", context, { useLrn: true }),
    queryAll(db, "sf2_attendance_entries", context, { useLrn: true }),
    queryAll(db, "sf5_promotion_entries", context, { useLrn: true }),
    db
      .from("psa_identity_records")
      .select("*, documents!inner(status)")
      .eq("school_id", context.schoolId)
      .eq("student_id", context.studentId)
      .not("documents.status", "in", '("archived","rejected")')
      .order("created_at", { ascending: false }),
    db
      .from("documents")
      .select("id, student_id, document_type, school_id, school_year, grade_level, section, extracted_fields, original_filename")
      .eq("school_id", context.schoolId)
      .eq("school_year", context.schoolYear)
      .eq("grade_level", context.gradeLevel)
      .in("document_type", ["sf9", "sf10"])
      .not("status", "in", '("archived","rejected")')
      .or(`student_id.eq.${context.studentId},extracted_fields->>lrn.eq.${normalizeLrn(context.lrn)}`)
      .order("created_at", { ascending: false }),
  ]);

  const sf1Rows: any[] = assertQuerySucceeded<any[]>("SF1 roster records", sf1Result) || [];
  const sf2Rows: any[] = assertQuerySucceeded<any[]>("SF2 attendance records", sf2Result) || [];
  const sf5Rows: any[] = assertQuerySucceeded<any[]>("SF5 promotion records", sf5Result) || [];
  const psaRows: any[] = assertQuerySucceeded<any[]>("PSA identity records", psaResult) || [];
  const documents: any[] = assertQuerySucceeded<any[]>("SF9/SF10 documents", documentsResult) || [];

  const scopedRows = (rows: any[]) =>
    rows.filter(
      (row) =>
        row.school_id === context.schoolId &&
        row.school_year === context.schoolYear &&
        row.grade_level === context.gradeLevel &&
        Boolean(row.section) &&
        String(row.section).trim().replace(/\s+/g, " ").toLowerCase() ===
          String(context.section).trim().replace(/\s+/g, " ").toLowerCase() &&
        normalizeLrn(row.lrn) === normalizeLrn(context.lrn)
    );

  const scopedDocuments = (type: "sf9" | "sf10") =>
    documents
      .filter((doc: any) =>
        doc.document_type === type && matchesStudentDocumentContext(doc, context)
      )
      .map((doc: any) => {
        const fields = doc.extracted_fields || {};
        return {
          ...doc,
          extracted_fields: {
            ...fields,
            school_year: doc.school_year || fields.school_year,
            grade_level: doc.grade_level || fields.grade_level,
            section: doc.section || fields.section,
            document_id: doc.id,
          },
        };
      });

  const scopedPsaRows = psaRows.filter(
    (row: any) => {
      const rowLrn = row.lrn || row.identity?.lrn;
      return row.school_id === context.schoolId &&
        row.student_id === context.studentId &&
        (!rowLrn || normalizeLrn(rowLrn) === normalizeLrn(context.lrn));
    }
  );

  return {
    sf1Entries: scopedRows(sf1Rows),
    sf2Entries: scopedRows(sf2Rows),
    sf5Entries: scopedRows(sf5Rows),
    psaRecords: scopedPsaRows,
    sf9Docs: scopedDocuments("sf9"),
    sf10Docs: scopedDocuments("sf10"),
  };
}

export function evaluateStudentValidation(
  context: StudentValidationContext,
  records: StudentValidationRecords,
  options: { duplicateWarnings?: any[] } = {}
): StudentValidationEvaluation {
  const sf1Entries = records.sf1Entries;
  const sf2Entries = records.sf2Entries;
  const sf5aEntries = records.sf5Entries.filter((entry) => entry.form_variant === "SF5A-SHS");
  const sf5bEntries = records.sf5Entries.filter((entry) => entry.form_variant === "SF5B-SHS");
  const sf9Docs = records.sf9Docs.filter((doc) => matchesStudentDocumentContext(doc, context));
  const sf10Docs = records.sf10Docs.filter((doc) => matchesStudentDocumentContext(doc, context));
  const sf9Records = sf9Docs.map((doc) => ({
    raw: {
      ...(doc.extracted_fields || {}),
      school_year: doc.school_year || doc.extracted_fields?.school_year,
      grade_level: doc.grade_level || doc.extracted_fields?.grade_level,
      section: doc.section || doc.extracted_fields?.section,
    },
    documentId: doc.id,
    schoolId: doc.school_id,
  }));
  const sf10Records = sf10Docs.map((doc) => ({
    raw: {
      ...(doc.extracted_fields || {}),
      school_year: doc.school_year || doc.extracted_fields?.school_year,
      grade_level: doc.grade_level || doc.extracted_fields?.grade_level,
      section: doc.section || doc.extracted_fields?.section,
    },
    documentId: doc.id,
    schoolId: doc.school_id,
  }));
  const pairwiseResults: PairwiseValidationResult[] = [];

  for (const sf1 of sf1Entries) {
    for (const psa of records.psaRecords) pairwiseResults.push(comparePsaAndSf1(psa, sf1));
    if (sf2Entries.length > 0) pairwiseResults.push(compareSf1AndSf2(sf1, sf2Entries));
    for (const sf5 of [...sf5aEntries, ...sf5bEntries]) pairwiseResults.push(compareSf1AndSf5(sf1, sf5));
    for (const sf9Doc of sf9Docs) {
      pairwiseResults.push(compareSf1AndSf9(sf1, {
        document_id: sf9Doc.id,
        lrn: sf9Doc.extracted_fields?.lrn,
        last_name: sf9Doc.extracted_fields?.last_name,
        first_name: sf9Doc.extracted_fields?.first_name,
        school_year: sf9Doc.school_year || sf9Doc.extracted_fields?.school_year,
        grade_level: sf9Doc.grade_level || sf9Doc.extracted_fields?.grade_level,
        section: sf9Doc.section || sf9Doc.extracted_fields?.section,
        strand: sf9Doc.extracted_fields?.strand || sf9Doc.extracted_fields?.track_strand,
      }));
    }
  }

  for (const sf9Doc of sf9Docs) {
    const fields = sf9Doc.extracted_fields || {};
    for (const sf10Doc of sf10Docs) {
      const sf10Fields = sf10Doc.extracted_fields || {};
      pairwiseResults.push(compareSf9AndSf10(
        {
          document_id: sf9Doc.id,
          school_year: sf9Doc.school_year || context.schoolYear,
          grade_level: sf9Doc.grade_level || context.gradeLevel,
          semester: fields.semester || "",
          grades: (fields.grades || []).map((grade: any) => ({
            ...grade,
            subject: grade.subject,
            quarter1: grade.quarter1 ?? grade.q1,
            quarter2: grade.quarter2 ?? grade.q2,
            finalGrade: grade.final ?? grade.finalGrade,
          })),
          general_average: fields.general_average,
        },
        {
          document_id: sf10Doc.id,
          school_year: sf10Doc.school_year || sf10Fields.school_year || "",
          grade_level: sf10Doc.grade_level || sf10Fields.grade_level || "",
          semester: sf10Fields.semester || "",
          grades: (sf10Fields.grades || []).map((grade: any) => ({
            ...grade,
            subject: grade.subject,
            quarter1: grade.quarter1 ?? grade.q1,
            quarter2: grade.quarter2 ?? grade.q2,
            finalGrade: grade.final ?? grade.finalGrade ?? grade.final_grade ?? grade.final_mark,
          })),
          completed_semesters: sf10Fields.completed_semesters || [],
          general_average: sf10Fields.general_average,
        }
      ));
    }

    for (const sf5 of [...sf5aEntries, ...sf5bEntries]) {
      pairwiseResults.push(compareSf5AndSf9(
        sf5,
        (fields.grades || []).map((grade: any) => ({
          ...grade,
          subject: grade.subject,
          schoolYear: grade.school_year || grade.schoolYear || sf9Doc.school_year || fields.school_year,
          gradeLevel: grade.grade_level || grade.gradeLevel || sf9Doc.grade_level || fields.grade_level,
          semester: grade.semester || fields.semester,
          gradingPeriod: grade.grading_period || grade.gradingPeriod || grade.quarter || grade.period,
          finalGrade: grade.final ?? grade.finalGrade ?? grade.final_grade ?? grade.final_mark,
        })),
        sf9Doc.id
      ));
    }
  }

  for (const sf5b of sf5bEntries) {
    for (const sf10Doc of sf10Docs) {
      const fields = sf10Doc.extracted_fields || {};
      pairwiseResults.push(compareSf5AndSf10(sf5b, {
        document_id: sf10Doc.id,
        completed_semesters: fields.completed_semesters || [],
        has_unresolved_back_subjects: Boolean(fields.has_unresolved_back_subjects),
        unresolved_subjects: fields.unresolved_subjects || [],
      }));
    }
  }

  const unifiedResult = evaluateUnifiedStudentValidation({
    lrn: context.lrn,
    fullName: context.fullName,
    studentId: context.studentId,
    schoolId: context.schoolId,
    schoolYear: context.schoolYear,
    gradeLevel: context.gradeLevel,
    section: context.section || sf9Records[0]?.raw?.section,
    trackStrand: context.trackStrand || sf9Records[0]?.raw?.strand,
    psaRecords: records.psaRecords.map((record) => ({ raw: record, documentId: record.document_id })),
    sf1Records: sf1Entries.map((entry) => ({ raw: entry, documentId: entry.document_id })),
    sf2Records: sf2Entries.map((entry) => ({ raw: entry, documentId: entry.document_id })),
    sf5aRecords: sf5aEntries.map((entry) => ({ raw: entry, documentId: entry.document_id })),
    sf5bRecords: sf5bEntries.map((entry) => ({ raw: entry, documentId: entry.document_id })),
    sf9Records,
    sf10Records,
    duplicateWarnings: options.duplicateWarnings,
  });

  const consolidated = evaluateConsolidatedShsStudent({
    studentId: context.studentId,
    schoolId: context.schoolId,
    schoolYear: context.schoolYear,
    gradeLevel: context.gradeLevel,
    documentPresence: {
      hasSf1: sf1Entries.length > 0,
      hasSf2: sf2Entries.length > 0,
      hasSf5: records.sf5Entries.length > 0,
      hasSf9: sf9Docs.length > 0,
      hasSf10: sf10Docs.length > 0,
      hasPsa: records.psaRecords.length > 0,
    },
    pairwiseResults,
  });

  const sourceDocumentIds = Array.from(new Set([
    ...sf1Entries,
    ...sf2Entries,
    ...records.sf5Entries,
    ...records.psaRecords,
  ].map((entry) => entry.document_id).filter(Boolean).concat(
    sf9Docs.map((doc) => doc.id),
    sf10Docs.map((doc) => doc.id)
  )));
  const traceSources = [
    { type: "PSA", column: "psaValue", entries: records.psaRecords.map((raw) => ({ raw, id: raw.document_id })) },
    { type: "SF1-SHS", column: "sf1Value", entries: sf1Entries.map((raw) => ({ raw, id: raw.document_id })) },
    { type: "SF2-SHS", column: "sf2Value", entries: sf2Entries.map((raw) => ({ raw, id: raw.document_id })) },
    { type: "SF5A-SHS", column: "sf5aValue", entries: sf5aEntries.map((raw) => ({ raw, id: raw.document_id })) },
    { type: "SF5B-SHS", column: "sf5bValue", entries: sf5bEntries.map((raw) => ({ raw, id: raw.document_id })) },
    { type: "SF9-SHS", column: "sf9Value", entries: sf9Records.map(({ raw, documentId }) => ({ raw, id: documentId })) },
    { type: "SF10-SHS", column: "sf10Value", entries: sf10Records.map(({ raw, documentId }) => ({ raw, id: documentId })) },
  ];
  const hasSourceValue = (value: unknown) => value !== undefined && value !== null && value !== "";
  const sourceValueForField = (field: string, type: string, raw: Record<string, unknown>) => {
    if (field === "lrn" && type === "PSA") return raw;
    if (field.startsWith("attendance_") && field !== "attendance_annual_summary") {
      if (type === "SF1-SHS") return raw;
      if (type === "SF2-SHS") {
        const monthKey = field.slice("attendance_".length).replace(/[^a-z]/gi, "").toLowerCase();
        return String(raw.month || "").replace(/[^a-z]/gi, "").toLowerCase() === monthKey ? raw.month : undefined;
      }
    }
    if (field === "attendance_annual_summary") {
      if (type === "SF2-SHS" || type === "SF9-SHS") {
        return raw.days_present ?? raw.days_absent ?? raw.total_school_days ?? raw.attendance_months;
      }
      return undefined;
    }
    if (field.startsWith("promotion_status_sf5a")) return type === "SF5A-SHS" ? raw.action_taken || raw.incomplete_subjects : undefined;
    if (field.startsWith("graduation_clearance_sf5b")) return type === "SF5B-SHS" ? raw.action_taken : undefined;
    if (field.startsWith("grade_")) return undefined;
    const aliases: Record<string, string[]> = {
      lrn: ["lrn"],
      last_name: ["last_name"],
      first_name: ["first_name"],
      middle_name: ["middle_name"],
      sex: ["sex"],
      birth_date: ["birth_date", "date_of_birth"],
      mother_maiden_name: ["mother_maiden_name", "mother_name"],
      father_name: ["father_name"],
      school_id: ["school_id"],
      school_year: ["school_year"],
      grade_level: ["grade_level"],
      section: ["section"],
      track_strand: ["track_strand", "strand", "track"],
      general_average: ["general_average"],
    };
    const directFields = aliases[field] || [field];
    for (const directField of directFields) {
      if (hasSourceValue(raw[directField])) return raw[directField];
    }
    if (field === "last_name" || field === "first_name") {
      const name = String(raw.learner_name || "");
      if (name.includes(",")) {
        const [lastName, firstName] = name.split(",", 2).map((part) => part.trim());
        return field === "last_name" ? lastName : firstName?.split(/\s+/)[0];
      }
    }
    const parentsDetails = raw.parents_details;
    const parentFields = parentsDetails && typeof parentsDetails === "object" && !Array.isArray(parentsDetails)
      ? parentsDetails as Record<string, unknown>
      : {};
    if (field === "mother_maiden_name") return parentFields.mother_name;
    if (field === "middle_name") return parentFields.middle_name;
    return undefined;
  };
  const traceInteger = (value: unknown, allowZero: boolean) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    (allowZero ? value >= 0 : value > 0)
      ? value
      : undefined;
  const traceableRows = unifiedResult.fieldsMatrix.map((row) => {
    const sourceRecords = traceSources.flatMap((source) => {
      if (!hasSourceValue(row[source.column as keyof typeof row])) return [];
      return source.entries
        .filter((entry) => hasSourceValue(sourceValueForField(row.field, source.type, entry.raw)))
        .map((entry) => ({ type: source.type, id: entry.id, raw: entry.raw }));
    });
    const rowSourceIds = row.sourceDocumentIds || [];
    const contributingRecords = sourceRecords.filter((source) =>
      source.id && (!rowSourceIds.length || rowSourceIds.includes(source.id))
    );
    const ids = Array.from(new Set([
      ...rowSourceIds,
      ...contributingRecords.map((source) => source.id).filter(Boolean),
    ] as string[]));
    const typesById = new Map(traceSources.flatMap((source) =>
      source.entries.filter((entry) => entry.id).map((entry) => [entry.id, source.type] as const)
    ));
    const types = Array.from(new Set([
      ...contributingRecords.map((source) => source.type),
      ...ids.map((id) => typesById.get(id)).filter(Boolean),
    ] as string[]));
    const sourceTraces: ComparisonSourceTrace[] = [
      ...(row.sourceTraces || []),
      ...contributingRecords.flatMap((source) => source.id ? [{
        documentId: source.id,
        documentType: source.type,
        fieldName: row.field,
        pageNumber: traceInteger(source.raw.page_number ?? source.raw.pageNumber, false),
        rowIndex: traceInteger(source.raw.row_index ?? source.raw.rowIndex, true),
        academicContext: {
          schoolYear: String(source.raw.school_year || source.raw.schoolYear || "") || undefined,
          gradeLevel: String(source.raw.grade_level || source.raw.gradeLevel || "") || undefined,
          section: String(source.raw.section || "") || undefined,
          semester: String(source.raw.semester || "") || undefined,
        },
      }] : []),
    ];
    const uniqueSourceTraces = sourceTraces.filter((trace, index) =>
      sourceTraces.findIndex((candidate) =>
        candidate.documentId === trace.documentId &&
        candidate.documentType === trace.documentType &&
        candidate.fieldName === trace.fieldName &&
        candidate.pageNumber === trace.pageNumber &&
        candidate.rowIndex === trace.rowIndex
      ) === index
    );
    return { ...row, sourceDocumentIds: ids, sourceDocumentTypes: types, sourceTraces: uniqueSourceTraces };
  });

  return {
    unifiedResult: { ...unifiedResult, fieldsMatrix: traceableRows },
    consolidated,
    pairwiseResults,
    sourceDocumentIds,
  };
}

function unwrapQueryResult(result: { data: any; error: { message?: string } | null }, operation: string) {
  if (result.error) {
    throw new Error(`${operation}: ${result.error.message || "database operation failed"}`);
  }
  return result.data;
}

function combinePairwiseResults(results: PairwiseValidationResult[]) {
  const grouped = new Map<string, PairwiseValidationResult>();
  const statusRank: Record<string, number> = {
    MATCH: 0,
    NOT_APPLICABLE: 1,
    NEEDS_VERIFICATION: 2,
    DISCREPANCIES_FOUND: 3,
    MISMATCH: 4,
    RESOLVED: 5,
  };
  for (const result of results) {
    const key = [
      result.validationType,
      result.semester || "Full Year",
      result.sourceDoc1Id || "",
      result.sourceDoc2Id || "",
    ].join("|");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...result,
        comparisonResults: [...result.comparisonResults],
        discrepancies: [...result.discrepancies],
      });
      continue;
    }
    if ((statusRank[result.status] || 0) > (statusRank[existing.status] || 0)) existing.status = result.status;
    existing.needsHumanReview ||= result.needsHumanReview;
    const comparisons = new Set(existing.comparisonResults.map((item) => JSON.stringify(item)));
    for (const comparison of result.comparisonResults) {
      const key = JSON.stringify(comparison);
      if (!comparisons.has(key)) {
        existing.comparisonResults.push(comparison);
        comparisons.add(key);
      }
    }
    const discrepancyKeys = new Set(existing.discrepancies.map((item) => JSON.stringify(item)));
    for (const discrepancy of result.discrepancies) {
      const key = JSON.stringify(discrepancy);
      if (!discrepancyKeys.has(key)) {
        existing.discrepancies.push(discrepancy);
        discrepancyKeys.add(key);
      }
    }
    existing.summaryMessage = [existing.summaryMessage, result.summaryMessage]
      .filter(Boolean)
      .filter((message, index, messages) => messages.indexOf(message) === index)
      .join(" ");
  }
  return Array.from(grouped.values());
}

export async function persistStudentValidation(
  db: any,
  context: StudentValidationContext,
  evaluation: StudentValidationEvaluation
) {
  if (!context.section?.trim()) {
    throw new Error("An advisory section is required to persist cross-document validation.");
  }

  const payloads: Array<Record<string, unknown>> = combinePairwiseResults(evaluation.pairwiseResults).map((result) => {
    const semester = result.semester || "Full Year";
    return {
      student_id: context.studentId,
      school_id: context.schoolId,
      school_year: context.schoolYear,
      grade_level: context.gradeLevel,
      section: context.section,
      semester,
      validation_type: result.validationType,
      source_doc1_id: result.sourceDoc1Id || null,
      source_doc2_id: result.sourceDoc2Id || null,
      persistence_key: `PAIR|${result.validationType}|${semester}|${result.sourceDoc1Id || ""}|${result.sourceDoc2Id || ""}`,
      comparison_results: result.comparisonResults,
      discrepancy_details: result.discrepancies,
      status: result.status,
      needs_human_review: result.needsHumanReview,
    };
  });

  const sourceSignature = evaluation.sourceDocumentIds.slice().sort().join("|");
  const consolidatedPayload = {
    student_id: context.studentId,
    school_id: context.schoolId,
    school_year: context.schoolYear,
    grade_level: context.gradeLevel,
    section: context.section,
    semester: "Full Year",
    validation_type: "CONSOLIDATED_SHS",
    source_doc1_id: evaluation.sourceDocumentIds[0] || null,
    source_doc2_id: evaluation.sourceDocumentIds[1] || null,
    source_signature: sourceSignature,
    persistence_key: `CONSOLIDATED|${sourceSignature}`,
    comparison_results: evaluation.unifiedResult.fieldsMatrix,
    discrepancy_details: evaluation.unifiedResult.discrepancies,
    status: evaluation.unifiedResult.overallStatus,
    needs_human_review: evaluation.unifiedResult.needsHumanReview,
  };
  payloads.push(consolidatedPayload);

  const batchResult = unwrapQueryResult(
    await db.rpc("persist_cross_document_validation_batch", { p_validations: payloads }),
    "Persist learner validation batch"
  );
  if (
    !batchResult ||
    batchResult.success !== true ||
    batchResult.persistedCount !== payloads.length ||
    !Array.isArray(batchResult.validations) ||
    batchResult.validations.length !== payloads.length
  ) {
    throw new Error("Persist learner validation batch: database returned an incomplete batch result.");
  }

  const savedRowsResult = await db
    .from("cross_document_validations")
    .select("*")
    .eq("student_id", context.studentId)
    .eq("school_id", context.schoolId)
    .eq("school_year", context.schoolYear)
    .eq("grade_level", context.gradeLevel)
    .eq("section", context.section)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const savedRows = unwrapQueryResult(savedRowsResult, "Retrieve persisted validation results");
  if (!Array.isArray(savedRows)) {
    throw new Error("Retrieve persisted validation results: database returned an invalid result.");
  }
  const persistedKeys = new Set(savedRows.map((row: any) => row.persistence_key));
  const missingPayload = payloads.find((payload) => !persistedKeys.has(payload.persistence_key));
  if (missingPayload) {
    throw new Error("Retrieve persisted validation results: one or more batch rows were not readable after persistence.");
  }
  return savedRows;
}

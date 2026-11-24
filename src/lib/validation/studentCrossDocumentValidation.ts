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

export function buildPersistedValidationResponse(validations: any[]) {
  const rows = validations || [];
  const consolidated = rows.find((row: any) => row.validation_type === "CONSOLIDATED_SHS") || null;
  return {
    validations: rows,
    consolidated,
    matrix: Array.isArray(consolidated?.comparison_results) ? consolidated.comparison_results : [],
    discrepancies: Array.isArray(consolidated?.discrepancy_details) ? consolidated.discrepancy_details : [],
  };
}

export async function fetchPersistedStudentValidation(
  db: any,
  studentId: string,
  schoolYear?: string | null,
  gradeLevel?: string | null
) {
  let query = db
    .from("cross_document_validations")
    .select("*")
    .eq("student_id", studentId);
  if (schoolYear) query = query.eq("school_year", schoolYear);
  if (gradeLevel) query = query.eq("grade_level", gradeLevel);
  const { data, error } = await query.order("created_at", { ascending: false });
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
        (!context.section || !row.section ||
          String(row.section).trim().replace(/\s+/g, " ").toLowerCase() ===
            String(context.section).trim().replace(/\s+/g, " ").toLowerCase()) &&
        normalizeLrn(row.lrn) === normalizeLrn(context.lrn)
    );

  const scopedDocuments = (type: "sf9" | "sf10") =>
    documents
      .filter((doc: any) => {
        if (doc.document_type !== type) return false;
        const fields = doc.extracted_fields || {};
        const documentLrn = fields.lrn ? normalizeLrn(fields.lrn) : "";
        if (documentLrn && documentLrn !== normalizeLrn(context.lrn)) return false;
        if (!documentLrn && doc.student_id !== context.studentId) return false;
        const documentGrade = doc.grade_level || fields.grade_level;
        if (documentGrade) {
          const gradeText = String(documentGrade);
          const normalizedGrade = gradeText.includes("12")
            ? "Grade 12"
            : gradeText.includes("11")
            ? "Grade 11"
            : null;
          if (normalizedGrade !== context.gradeLevel) return false;
        }
        const documentSection = doc.section || fields.section;
        return !context.section || !documentSection ||
          String(documentSection).trim().replace(/\s+/g, " ").toLowerCase() ===
            String(context.section).trim().replace(/\s+/g, " ").toLowerCase();
      })
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
    (row: any) => row.school_id === context.schoolId && row.student_id === context.studentId
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
  const sf9Records = records.sf9Docs.map((doc) => ({
    raw: doc.extracted_fields || {},
    documentId: doc.id,
  }));
  const sf10Records = records.sf10Docs.map((doc) => ({
    raw: doc.extracted_fields || {},
    documentId: doc.id,
  }));
  const sf1Entry = sf1Entries[0] || null;
  const psaRecord = records.psaRecords[0] || null;
  const pairwiseResults: PairwiseValidationResult[] = [];

  for (const sf1 of sf1Entries) {
    for (const psa of records.psaRecords) pairwiseResults.push(comparePsaAndSf1(psa, sf1));
    if (sf2Entries.length > 0) pairwiseResults.push(compareSf1AndSf2(sf1, sf2Entries));
    for (const sf5 of [...sf5aEntries, ...sf5bEntries]) pairwiseResults.push(compareSf1AndSf5(sf1, sf5));
    for (const sf9Doc of records.sf9Docs) {
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

  for (const sf9Doc of records.sf9Docs) {
    const fields = sf9Doc.extracted_fields || {};
    for (const sf10Doc of records.sf10Docs) {
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
    for (const sf10Doc of records.sf10Docs) {
      const fields = sf10Doc.extracted_fields || {};
      pairwiseResults.push(compareSf5AndSf10(sf5b, {
        document_id: sf10Doc.id,
        completed_semesters: fields.completed_semesters || [],
        has_unresolved_back_subjects: Boolean(fields.has_unresolved_back_subjects),
        unresolved_subjects: fields.unresolved_subjects || [],
      }));
    }
  }

  const sf5a = sf5aEntries[0] || undefined;
  const sf5b = sf5bEntries[0] || undefined;
  const unifiedResult = evaluateUnifiedStudentValidation({
    lrn: context.lrn,
    fullName: context.fullName,
    studentId: context.studentId,
    schoolId: context.schoolId,
    schoolYear: context.schoolYear,
    gradeLevel: context.gradeLevel,
    section: sf1Entry?.section || context.section || sf9Records[0]?.raw?.section,
    trackStrand: sf1Entry?.strand || sf1Entry?.track || context.trackStrand || sf9Records[0]?.raw?.strand,
    psa: psaRecord ? { raw: psaRecord, documentId: psaRecord.document_id } : undefined,
    sf1: sf1Entry ? { raw: sf1Entry, documentId: sf1Entry.document_id } : undefined,
    sf2Records: sf2Entries.map((entry) => ({ raw: entry, documentId: entry.document_id })),
    sf5a: sf5a ? { raw: sf5a, documentId: sf5a.document_id } : undefined,
    sf5b: sf5b ? { raw: sf5b, documentId: sf5b.document_id } : undefined,
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
      hasSf9: records.sf9Docs.length > 0,
      hasSf10: records.sf10Docs.length > 0,
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
    records.sf9Docs.map((doc) => doc.id),
    records.sf10Docs.map((doc) => doc.id)
  )));
  const sourceDocumentTypes = [
    ...sf1Entries.map(() => "SF1-SHS"),
    ...sf2Entries.map(() => "SF2-SHS"),
    ...sf5aEntries.map(() => "SF5A-SHS"),
    ...sf5bEntries.map(() => "SF5B-SHS"),
    ...records.psaRecords.map(() => "PSA"),
    ...records.sf9Docs.map(() => "SF9-SHS"),
    ...records.sf10Docs.map(() => "SF10-SHS"),
  ];
  const traceableRows = unifiedResult.fieldsMatrix.map((row) => ({
    ...row,
    sourceDocumentIds: row.sourceDocumentIds?.length ? row.sourceDocumentIds : sourceDocumentIds,
    sourceDocumentTypes,
  }));

  return {
    unifiedResult: { ...unifiedResult, fieldsMatrix: traceableRows },
    consolidated,
    pairwiseResults,
    sourceDocumentIds,
  };
}

function isResolved(row: any): boolean {
  return row?.status === "RESOLVED" || Boolean(row?.resolved_by) || Boolean(row?.resolved_at);
}

function sameSourcePair(row: any, validation: PairwiseValidationResult): boolean {
  return (row.source_doc1_id || null) === (validation.sourceDoc1Id || null) &&
    (row.source_doc2_id || null) === (validation.sourceDoc2Id || null) &&
    (row.semester || "Full Year") === (validation.semester || "Full Year") &&
    (row.grade_level || "Grade 11") === (validation.gradeLevel || "Grade 11");
}

function unwrapQueryResult(result: { data: any; error: { message?: string } | null }, operation: string) {
  if (result.error) {
    throw new Error(`${operation}: ${result.error.message || "database operation failed"}`);
  }
  return result.data;
}

export async function persistStudentValidation(
  db: any,
  context: StudentValidationContext,
  evaluation: StudentValidationEvaluation
) {
  for (const result of evaluation.pairwiseResults) {
    const rowsResult = await db
      .from("cross_document_validations")
      .select("*")
      .eq("student_id", context.studentId)
      .eq("school_id", context.schoolId)
      .eq("school_year", context.schoolYear)
      .eq("validation_type", result.validationType);
    const rows = unwrapQueryResult(rowsResult, `Lookup ${result.validationType} validation`) || [];
    const matching = rows.find((row: any) => sameSourcePair(row, result));
    if (matching && isResolved(matching)) continue;

    const payload = {
      student_id: context.studentId,
      school_id: context.schoolId,
      school_year: context.schoolYear,
      grade_level: result.gradeLevel || context.gradeLevel,
      semester: result.semester || "Full Year",
      validation_type: result.validationType,
      source_doc1_id: result.sourceDoc1Id || null,
      source_doc2_id: result.sourceDoc2Id || null,
      comparison_results: result.comparisonResults,
      discrepancy_details: result.discrepancies,
      status: result.status,
      needs_human_review: result.needsHumanReview,
    };

    if (matching?.id) {
      unwrapQueryResult(
        await db.from("cross_document_validations").update(payload).eq("id", matching.id),
        `Update ${result.validationType} validation`
      );
    } else {
      unwrapQueryResult(
        await db.from("cross_document_validations").insert(payload),
        `Insert ${result.validationType} validation`
      );
    }
  }

  const consolidatedRowsResult = await db
    .from("cross_document_validations")
    .select("*")
    .eq("student_id", context.studentId)
    .eq("school_id", context.schoolId)
    .eq("school_year", context.schoolYear)
    .eq("validation_type", "CONSOLIDATED_SHS");
  const consolidatedRows = unwrapQueryResult(consolidatedRowsResult, "Lookup consolidated validation") || [];
  const sourceSignature = evaluation.sourceDocumentIds.slice().sort().join("|");
  const matchingResolved = consolidatedRows.find((row: any) =>
    isResolved(row) &&
    Array.isArray(row.comparison_results) &&
    row.comparison_results.some((item: any) =>
      Array.isArray(item.sourceDocumentIds) &&
      item.sourceDocumentIds.slice().sort().join("|") === sourceSignature
    )
  );
  const matchingUnresolved = consolidatedRows.find((row: any) => !isResolved(row));

  if (!matchingResolved) {
    const payload = {
      student_id: context.studentId,
      school_id: context.schoolId,
      school_year: context.schoolYear,
      grade_level: context.gradeLevel,
      semester: "Full Year",
      validation_type: "CONSOLIDATED_SHS",
      source_doc1_id: evaluation.sourceDocumentIds[0] || null,
      source_doc2_id: evaluation.sourceDocumentIds[1] || null,
      comparison_results: evaluation.unifiedResult.fieldsMatrix,
      discrepancy_details: evaluation.unifiedResult.discrepancies,
      status: evaluation.unifiedResult.overallStatus,
      needs_human_review: evaluation.unifiedResult.needsHumanReview,
    };
    if (matchingUnresolved?.id) {
      unwrapQueryResult(
        await db.from("cross_document_validations").update(payload).eq("id", matchingUnresolved.id),
        "Update consolidated validation"
      );
    } else {
      unwrapQueryResult(
        await db.from("cross_document_validations").insert(payload),
        "Insert consolidated validation"
      );
    }
  }

  const savedRowsResult = await db
    .from("cross_document_validations")
    .select("*")
    .eq("student_id", context.studentId)
    .eq("school_id", context.schoolId)
    .eq("school_year", context.schoolYear)
    .order("created_at", { ascending: false });
  return unwrapQueryResult(savedRowsResult, "Retrieve persisted validation results") || [];
}

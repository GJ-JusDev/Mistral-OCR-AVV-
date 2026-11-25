import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildPersistedValidationResponse,
  evaluateStudentValidation,
  fetchLegacySf1Sf2Entries,
  fetchPersistedStudentValidation,
  fetchStudentValidationRecords,
  getPersistenceFailureResponse,
  normalizePersistedValidationResponse,
  persistStudentValidation,
  readPersistedValidationResponse,
} from "../src/lib/validation/studentCrossDocumentValidation.ts";
import {
  evaluateBatchCrossDocumentValidation,
  rebuildBatchValidationReportFromPersistedResults,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";
import {
  evaluateRequiredDocumentCoverage,
  buildDocumentCompletenessChecklist,
  compareSectionSf1AndSf2,
  evaluateUnifiedStudentValidation,
} from "../src/lib/validation/crossDocumentEngine.ts";
import {
  buildPersistedValidationUrl,
  chooseInitialStudentAcademicContext,
  getStudentAcademicContexts,
} from "../src/lib/validation/studentValidationContext.ts";

const ROOT = process.cwd();
const CONTEXT = {
  studentId: "student-1",
  lrn: "109345000001",
  schoolId: "school-1",
  schoolYear: "2024-2025",
  gradeLevel: "Grade 11",
  fullName: "Carlos Dela Cruz",
  section: "Diamond",
  trackStrand: "STEM",
};

class MockQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.action = "select";
    this.payload = null;
    this.ordering = [];
  }

  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  not() { return this; }
  or() { return this; }
  order(column, options = {}) {
    this.ordering.push({ column, ascending: options.ascending !== false });
    return this;
  }
  update(payload) { this.action = "update"; this.payload = payload; return this; }
  insert(payload) { this.action = "insert"; this.payload = payload; return this; }
  async maybeSingle() {
    const result = await this.execute();
    return { data: result.data?.[0] || null, error: result.error };
  }

  async execute() {
    if (this.db.failure && this.db.failure.table === this.table &&
        (!this.db.failure.action || this.db.failure.action === this.action)) {
      return { data: null, error: { message: "simulated persistence failure" } };
    }
    if (this.db.emptyReadAfterRpc && this.table === "cross_document_validations" &&
        this.action === "select" && this.db.rpcCalls.length > 0) {
      return { data: [], error: null };
    }

    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);
    const matching = rows.filter((row) => this.filters.every((filter) => filter(row)));
    for (const ordering of this.ordering.slice().reverse()) {
      matching.sort((left, right) => {
        const comparison = String(left[ordering.column] || "").localeCompare(
          String(right[ordering.column] || "")
        );
        return ordering.ascending ? comparison : -comparison;
      });
    }
    if (this.action === "insert") {
      for (const payload of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const now = new Date(Date.now() + ++this.db.nextId).toISOString();
        rows.push({ id: `row-${this.db.nextId}`, created_at: now, updated_at: now, ...payload });
      }
      return { data: null, error: null };
    }
    if (this.action === "update") {
      for (const row of matching) Object.assign(row, this.payload);
      return { data: matching, error: null };
    }
    return { data: matching, error: null };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

function makeDb() {
  return {
    tables: {
      sf1_roster_entries: [],
      sf2_attendance_entries: [],
      sf5_promotion_entries: [],
      psa_identity_records: [],
      documents: [],
      cross_document_validations: [],
    },
    nextId: 0,
    failure: null,
    emptyReadAfterRpc: false,
    rpcCalls: [],
    from(table) { return new MockQuery(this, table); },
    async rpc(name, args) {
      this.rpcCalls.push({ name, args });
      if (name !== "persist_cross_document_validation_batch") {
        return { data: null, error: { message: `unexpected RPC ${name}` } };
      }
      if (this.failure?.table === "cross_document_validations" &&
          this.failure.failAt === undefined &&
          (!this.failure.action || this.failure.action === "rpc")) {
        return { data: null, error: { message: "simulated persistence failure" } };
      }

      const stagedRows = this.tables.cross_document_validations.map((row) => ({ ...row }));
      const savedRows = [];
      for (const [index, payload] of args.p_validations.entries()) {
        if (this.failure?.failAt === index + 1) {
          return { data: null, error: { message: "simulated mid-batch failure" } };
        }
        const existing = stagedRows.find((row) =>
          row.student_id === payload.student_id &&
          row.school_id === payload.school_id &&
          row.school_year === payload.school_year &&
          row.grade_level === payload.grade_level &&
          row.section === payload.section &&
          row.persistence_key === payload.persistence_key
        );
        if (!existing) {
          const now = new Date(Date.now() + ++this.nextId).toISOString();
          const row = {
            id: `row-${this.nextId}`,
            created_at: now,
            updated_at: now,
            ...payload,
          };
          stagedRows.push(row);
          savedRows.push(row);
        } else {
          if (
            existing.status !== "RESOLVED" &&
            !existing.resolved_by &&
            !existing.resolved_at &&
            !existing.resolution_notes
          ) {
            Object.assign(existing, payload);
            existing.updated_at = new Date(Date.now() + ++this.nextId).toISOString();
          }
          savedRows.push(existing);
        }
      }
      this.tables.cross_document_validations = stagedRows;
      return {
        data: { success: true, persistedCount: savedRows.length, validations: savedRows },
        error: null,
      };
    },
  };
}

function sf1() {
  return {
    id: "sf1-row",
    document_id: "doc-sf1",
    school_id: CONTEXT.schoolId,
    school_year: CONTEXT.schoolYear,
    grade_level: CONTEXT.gradeLevel,
    section: CONTEXT.section,
    track: "Academic",
    strand: CONTEXT.trackStrand,
    semester: "1st Semester",
    lrn: CONTEXT.lrn,
    last_name: "Dela Cruz",
    first_name: "Carlos",
    middle_name: "Mendoza",
    sex: "M",
    birth_date: "2007-03-15",
  };
}

function sf2() {
  return {
    id: "sf2-row",
    document_id: "doc-sf2",
    school_id: CONTEXT.schoolId,
    school_year: CONTEXT.schoolYear,
    grade_level: CONTEXT.gradeLevel,
    section: CONTEXT.section,
    lrn: CONTEXT.lrn,
    learner_name: "Dela Cruz, Carlos",
    month: "August",
    total_school_days: 21,
    days_present: 20,
    days_absent: 1,
  };
}

function schoolDocument(id, type, extractedFields) {
  return {
    id,
    student_id: CONTEXT.studentId,
    school_id: CONTEXT.schoolId,
    school_year: CONTEXT.schoolYear,
    grade_level: CONTEXT.gradeLevel,
    section: CONTEXT.section,
    document_type: type,
    extracted_fields: { lrn: CONTEXT.lrn, ...extractedFields },
  };
}

async function validateAndPersist(db) {
  const records = await fetchStudentValidationRecords(db, CONTEXT);
  const evaluation = evaluateStudentValidation(CONTEXT, records);
  const saved = await persistStudentValidation(db, CONTEXT, evaluation);
  return { records, evaluation, saved };
}

test("cross-batch validation combines earlier SF1/SF2 with later SF9/SF10 by LRN", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());

  let result = await validateAndPersist(db);
  assert.equal(result.records.sf1Entries.length, 1);
  assert.equal(result.records.sf2Entries.length, 0);

  db.tables.sf2_attendance_entries.push(sf2());
  result = await validateAndPersist(db);
  assert.equal(result.evaluation.pairwiseResults.some((row) => row.validationType === "SF1_SF2"), true);

  db.tables.documents.push(schoolDocument("doc-sf9-1", "sf9", {
    semester: "1st Semester",
    grades: [{ subject: "Oral Communication", final: 90 }],
    general_average: 90,
    attendance_months: ["August"],
    attendance: [
      { label: "No. of school days", values: [21] },
      { label: "No. of days present", values: [20] },
      { label: "No. of days absent", values: [1] },
    ],
  }));
  result = await validateAndPersist(db);
  assert.equal(result.records.sf9Docs.length, 1);
  assert.ok(result.evaluation.unifiedResult.fieldsMatrix.some((row) => row.label === "Subject: Oral Communication"));
  assert.ok(result.evaluation.unifiedResult.fieldsMatrix.some((row) => row.field === "attendance_august"));
  assert.equal(
    result.evaluation.unifiedResult.fieldsMatrix.some((row) => row.status === "MISMATCH"),
    false,
    "Absent document types must not be interpreted as mismatches"
  );

  db.tables.documents.push(schoolDocument("doc-sf10-1", "sf10", {
    semester: "1st Semester",
    grades: [{ subject: "Oral Communication", final: 90 }],
    general_average: 90,
  }));
  result = await validateAndPersist(db);
  const consolidated = result.saved.find((row) => row.validation_type === "CONSOLIDATED_SHS");
  assert.ok(consolidated);
  assert.deepEqual(
    consolidated.comparison_results[0].sourceDocumentIds.sort(),
    ["doc-sf1", "doc-sf2", "doc-sf9-1", "doc-sf10-1"].sort()
  );
  assert.ok(result.evaluation.pairwiseResults.some((row) => row.validationType === "SF9_SF10"));
});

test("all SF9 and SF10 records for the learner contribute to the matrix and retain traceability", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  db.tables.documents.push(
    schoolDocument("doc-sf9-a", "sf9", {
      semester: "1st Semester",
      grades: [{ subject: "Oral Communication", final: 90 }],
      general_average: 90,
    }),
    schoolDocument("doc-sf9-b", "sf9", {
      semester: "2nd Semester",
      grades: [{ subject: "Oral Communication", final: 92 }],
      general_average: 92,
    }),
    schoolDocument("doc-sf10-a", "sf10", {
      semester: "1st Semester",
      grades: [{ subject: "Oral Communication", final: 90 }],
    }),
    schoolDocument("doc-sf10-b", "sf10", {
      semester: "2nd Semester",
      grades: [{ subject: "Oral Communication", final: 92 }],
    })
  );

  const { records, evaluation } = await validateAndPersist(db);
  assert.equal(records.sf9Docs.length, 2);
  assert.equal(records.sf10Docs.length, 2);
  const oralRows = evaluation.unifiedResult.fieldsMatrix.filter((row) => row.label === "Subject: Oral Communication");
  assert.equal(oralRows.length, 2);
  assert.ok(oralRows.some((row) => row.field.includes("_1stsemester_")));
  assert.ok(oralRows.some((row) => row.field.includes("_2ndsemester_")));
  assert.equal(oralRows.every((row) => row.status === "MATCH"), true);
  assert.equal(
    evaluation.pairwiseResults.filter((row) => row.validationType === "SF9_SF10").length,
    4,
    "Every SF9 record is compared with every in-scope SF10 record"
  );
  assert.deepEqual(
    evaluation.sourceDocumentIds.sort(),
    ["doc-sf1", "doc-sf9-a", "doc-sf9-b", "doc-sf10-a", "doc-sf10-b"].sort()
  );
});

test("all in-context SF1, PSA, SF5A, and SF5B records contribute and conflicting duplicates require review", () => {
  const sf1A = { ...sf1(), document_id: "doc-sf1-a" };
  const sf1B = {
    ...sf1(),
    id: "sf1-row-b",
    document_id: "doc-sf1-b",
    last_name: "Santos",
  };
  const psaRecords = [
    {
      document_id: "doc-psa-a",
      school_id: CONTEXT.schoolId,
      student_id: CONTEXT.studentId,
      last_name: "Dela Cruz",
      first_name: "Carlos",
      middle_name: "Mendoza",
      sex: "M",
      birth_date: "2007-03-15",
    },
    {
      document_id: "doc-psa-b",
      school_id: CONTEXT.schoolId,
      student_id: CONTEXT.studentId,
      last_name: "Dela Cruz",
      first_name: "Carlos",
      middle_name: "Mendoza",
      sex: "M",
      birth_date: "2007-03-16",
    },
  ];
  const sf5Records = [
    {
      document_id: "doc-sf5a-a",
      form_variant: "SF5A-SHS",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      semester: "1st Semester",
      lrn: CONTEXT.lrn,
      action_taken: "COMPLETE",
    },
    {
      document_id: "doc-sf5a-b",
      form_variant: "SF5A-SHS",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      semester: "1st Semester",
      lrn: CONTEXT.lrn,
      action_taken: "INCOMPLETE",
    },
    {
      document_id: "doc-sf5b-a",
      form_variant: "SF5B-SHS",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      lrn: CONTEXT.lrn,
      action_taken: "GRADUATING",
    },
    {
      document_id: "doc-sf5b-b",
      form_variant: "SF5B-SHS",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      lrn: CONTEXT.lrn,
      action_taken: "NOT_GRADUATING",
    },
  ];
  const evaluation = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [sf1A, sf1B],
    sf2Entries: [],
    sf5Entries: sf5Records,
    psaRecords,
    sf9Docs: [],
    sf10Docs: [],
  });
  const lastName = evaluation.unifiedResult.fieldsMatrix.find((row) => row.field === "last_name");
  const birthDate = evaluation.unifiedResult.fieldsMatrix.find((row) => row.field === "birth_date");
  const promotion = evaluation.unifiedResult.fieldsMatrix.find((row) => row.field === "promotion_status_sf5a");
  const graduation = evaluation.unifiedResult.fieldsMatrix.find((row) => row.field === "graduation_clearance_sf5b");

  assert.equal(lastName.status, "NEEDS_VERIFICATION");
  assert.ok(lastName.sf1Value.includes("doc-sf1-a"));
  assert.ok(lastName.sf1Value.includes("doc-sf1-b"));
  assert.ok(lastName.sourceDocumentIds.includes("doc-sf1-a"));
  assert.ok(lastName.sourceDocumentIds.includes("doc-sf1-b"));
  assert.ok(!lastName.sourceDocumentIds.includes("doc-sf5a-a"), "Unrelated document IDs must not be assigned to this row.");

  assert.equal(birthDate.status, "NEEDS_VERIFICATION");
  assert.ok(birthDate.sourceDocumentIds.includes("doc-psa-a"));
  assert.ok(birthDate.sourceDocumentIds.includes("doc-psa-b"));
  assert.equal(promotion.status, "NEEDS_VERIFICATION");
  assert.ok(promotion.sourceDocumentIds.includes("doc-sf5a-a"));
  assert.ok(promotion.sourceDocumentIds.includes("doc-sf5a-b"));
  assert.equal(graduation.status, "NEEDS_VERIFICATION");
  assert.ok(graduation.sourceDocumentIds.includes("doc-sf5b-a"));
  assert.ok(graduation.sourceDocumentIds.includes("doc-sf5b-b"));
  assert.ok(evaluation.unifiedResult.duplicateWarnings.length >= 4);
  assert.ok(evaluation.unifiedResult.discrepancies.some((item) => item.field.startsWith("conflicting_sf1_")));
  assert.ok(evaluation.unifiedResult.discrepancies.some((item) => item.field.startsWith("conflicting_psa_")));
});

test("same-name records from another LRN or academic context are never consolidated", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(
    sf1(),
    { ...sf1(), id: "wrong-lrn", document_id: "wrong-lrn-doc", lrn: "109345000002" },
    { ...sf1(), id: "wrong-year", document_id: "wrong-year-doc", school_year: "2023-2024" },
    { ...sf1(), id: "wrong-section", document_id: "wrong-section-doc", section: "Emerald" },
    { ...sf1(), id: "wrong-school", document_id: "wrong-school-doc", school_id: "school-2" }
  );
  db.tables.documents.push(
    schoolDocument("wrong-document-lrn", "sf9", {
      lrn: "109345000002",
      grades: [{ subject: "Oral Communication", final: 98 }],
    }),
    {
      ...schoolDocument("wrong-document-section", "sf9", {
        grades: [{ subject: "Oral Communication", final: 98 }],
      }),
      section: "Emerald",
    }
  );

  const records = await fetchStudentValidationRecords(db, CONTEXT);
  assert.deepEqual(records.sf1Entries.map((row) => row.id), ["sf1-row"]);
  assert.equal(records.sf9Docs.length, 0);
});

test("later validation extends prior comparisons without erasing unrelated pairs", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  db.tables.sf2_attendance_entries.push(sf2());
  const first = await validateAndPersist(db);
  const originalPairwise = db.tables.cross_document_validations.find((row) => row.validation_type === "SF1_SF2");
  assert.ok(originalPairwise);

  db.tables.documents.push(schoolDocument("doc-sf9-new", "sf9", {
    semester: "1st Semester",
    grades: [{ subject: "Mathematics", final: 90 }],
  }));
  const second = await validateAndPersist(db);
  const pairwiseAfter = db.tables.cross_document_validations.find((row) => row.id === originalPairwise.id);
  assert.equal(pairwiseAfter.source_doc1_id, originalPairwise.source_doc1_id);
  assert.equal(pairwiseAfter.source_doc2_id, originalPairwise.source_doc2_id);
  const consolidated = second.saved.find((row) => row.validation_type === "CONSOLIDATED_SHS");
  assert.ok(consolidated.comparison_results[0].sourceDocumentIds.includes("doc-sf2"));
  assert.ok(consolidated.comparison_results[0].sourceDocumentIds.includes("doc-sf9-new"));
  assert.equal(first.saved.filter((row) => row.validation_type === "CONSOLIDATED_SHS").length, 1);

  db.tables.documents = db.tables.documents.filter((doc) => doc.id !== "doc-sf9-new");
  const third = await validateAndPersist(db);
  const latest = third.saved.find((row) => row.validation_type === "CONSOLIDATED_SHS");
  assert.ok(!latest.comparison_results[0].sourceDocumentIds.includes("doc-sf9-new"));
});

test("teacher-resolved validation records and resolution metadata are preserved", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  db.tables.sf2_attendance_entries.push(sf2());
  const { evaluation } = await validateAndPersist(db);
  const pair = evaluation.pairwiseResults.find((row) => row.validationType === "SF1_SF2");
  const resolvedRow = db.tables.cross_document_validations.find(
    (row) => row.validation_type === "SF1_SF2"
  );
  Object.assign(resolvedRow, {
    status: "RESOLVED",
    resolved_by: "teacher-1",
    resolved_at: "2024-09-01T08:00:00Z",
    resolution_notes: "Verified against signed attendance register",
  });
  const resolvedSnapshot = { ...resolvedRow };

  await persistStudentValidation(db, CONTEXT, evaluation);
  assert.deepEqual(
    db.tables.cross_document_validations.find((row) => row.id === resolvedRow.id),
    resolvedSnapshot
  );
  assert.equal(
    db.tables.cross_document_validations.filter(
      (row) => row.validation_type === "SF1_SF2" && row.source_doc1_id === pair.sourceDoc1Id && row.source_doc2_id === pair.sourceDoc2Id
    ).length,
    1,
    "Resolved source pair is not duplicated or overwritten"
  );
});

test("persisted GET response exposes the consolidated matrix and discrepancies to the hub", () => {
  const row = {
    validation_type: "CONSOLIDATED_SHS",
    comparison_results: [{ field: "lrn", sourceDocumentIds: ["doc-sf1"] }],
    discrepancy_details: [{ field: "birth_date", severity: "WARNING" }],
  };
  const response = buildPersistedValidationResponse([row]);
  assert.deepEqual(response.consolidated, row);
  assert.deepEqual(response.matrix, row.comparison_results);
  assert.deepEqual(response.discrepancies, row.discrepancy_details);

  const enrollments = [
    { school_id: "school-1", school_year: "2023-2024", grade_level: "Grade 11", section: "Emerald" },
    { school_id: "school-1", school_year: "2024-2025", grade_level: "Grade 12", section: "Diamond", is_current: true, enrollment_status: "active" },
  ];
  const contexts = getStudentAcademicContexts(enrollments, [
    { school_id: "school-1", school_year: "2025-2026", grade_level: "Grade 12", section: "Diamond", created_at: "latest" },
    { school_id: "school-2", school_year: "2026-2027", grade_level: "Grade 12", section: "Diamond", created_at: "other-school" },
  ], "school-1");
  assert.deepEqual(
    chooseInitialStudentAcademicContext(enrollments, contexts),
    { schoolId: "school-1", schoolYear: "2024-2025", gradeLevel: "Grade 12", section: "Diamond" },
    "An active enrollment controls selection rather than the newest validation record."
  );
  assert.equal(chooseInitialStudentAcademicContext(enrollments.slice(0, 1), contexts.slice(0, 2)), null);
  assert.equal(
    buildPersistedValidationUrl("student-1", contexts[1]),
    "/api/validation/cross-document?studentId=student-1&schoolId=school-1&schoolYear=2024-2025&gradeLevel=Grade+12&section=Diamond"
  );
  assert.equal(
    getStudentAcademicContexts([
      { school_id: "school-1", school_year: "2024-2025", grade_level: "Grade 12", section: "Diamond" },
      { school_id: "school-1", school_year: "2024-2025", grade_level: "Grade 12", section: "Emerald" },
    ], [], "school-1").length,
    2,
    "Distinct advisory assignments remain selectable."
  );
  const sectionHistory = getStudentAcademicContexts(
    [{ school_id: "school-1", school_year: "2024-2025", grade_level: "Grade 12", section: "Emerald" }],
    [{ school_id: "school-1", school_year: "2024-2025", grade_level: "Grade 12", section: "Diamond" }],
    "school-1"
  );
  assert.deepEqual(sectionHistory.map((context) => context.section), ["Emerald", "Diamond"]);

  const studentPage = fs.readFileSync(path.join(ROOT, "src/app/students/[id]/page.tsx"), "utf8");
  const hub = fs.readFileSync(path.join(ROOT, "src/components/validation/ShsConsolidatedValidationHub.tsx"), "utf8");
  assert.match(studentPage, /buildPersistedValidationUrl\(studentId, context\)/);
  assert.match(studentPage, /chooseInitialStudentAcademicContext\(json\.enrollments, contexts\)/);
  assert.match(studentPage, /initialValidationRecord=\{data\.validationRecord\}/);
  assert.match(hub, /activeValidationRecord\.comparison_results/);
  assert.match(hub, /activeValidationRecord\?\.discrepancy_details/);
  assert.match(hub, /schoolYear,/);
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/validation/cross-document/route.ts"), "utf8");
  assert.match(route, /const schoolId = searchParams\.get\("schoolId"\)/);
  assert.match(route, /const section = searchParams\.get\("section"\)/);
  assert.match(route, /fetchPersistedStudentValidation\(/);
  const validationService = fs.readFileSync(path.join(ROOT, "src/lib/validation/studentCrossDocumentValidation.ts"), "utf8");
  assert.match(validationService, /\.eq\("school_id", context\.schoolId\)/);
  assert.match(validationService, /\.eq\("section", context\.section\)/);
});

test("hub response displays only a persisted consolidated row while retaining pairwise rows", async () => {
  const persistedRecord = {
    validation_type: "CONSOLIDATED_SHS",
    comparison_results: [{ field: "last_name", sourceDocumentIds: ["sf1-doc"] }],
    discrepancy_details: [{ field: "last_name", severity: "WARNING" }],
  };
  const pairwiseRow = {
    validation_type: "SF1_SF2",
    status: "NEEDS_VERIFICATION",
    comparison_results: [{ field: "attendance" }],
    discrepancy_details: [{ field: "attendance", severity: "WARNING" }],
  };
  const persisted = normalizePersistedValidationResponse({
    consolidated: persistedRecord,
    matrix: persistedRecord.comparison_results,
    discrepancies: persistedRecord.discrepancy_details,
    validations: [pairwiseRow, persistedRecord],
  });
  assert.equal(persisted.consolidated, persistedRecord);
  assert.deepEqual(persisted.matrix, persistedRecord.comparison_results);
  assert.equal(persisted.pairwiseResults.length, 1);
  assert.equal(persisted.pairwiseResults[0].validationType, "SF1_SF2");

  const noConsolidated = normalizePersistedValidationResponse({
    consolidated: null,
    matrix: [{ field: "must-not-display" }],
    discrepancies: [{ field: "must-not-display" }],
    validations: [pairwiseRow],
  });
  assert.equal(noConsolidated.consolidated, null);
  assert.deepEqual(noConsolidated.matrix, []);
  assert.deepEqual(noConsolidated.discrepancies, []);
  assert.equal(noConsolidated.pairwiseResults.length, 1, "Pairwise results remain separate from the missing matrix.");

  await assert.rejects(
    () => readPersistedValidationResponse({
      ok: false,
      json: async () => ({ error: "Persisted read failed." }),
    }),
    /Persisted read failed/
  );
  const hub = fs.readFileSync(path.join(ROOT, "src/components/validation/ShsConsolidatedValidationHub.tsx"), "utf8");
  assert.match(hub, /readPersistedValidationResponse\(savedRes\)/);
  assert.doesNotMatch(hub, /: json\.consolidated/);
  assert.match(hub, /setPairwiseResults\(\[\]\)/);
});

test("persisted validation retrieval is constrained to the selected school year and grade", async () => {
  const db = makeDb();
  const selected = {
    id: "selected-context",
    student_id: CONTEXT.studentId,
    school_id: CONTEXT.schoolId,
    school_year: "2024-2025",
    grade_level: "Grade 12",
    section: CONTEXT.section,
    validation_type: "CONSOLIDATED_SHS",
    comparison_results: [{ field: "selected-year-row" }],
    discrepancy_details: [{ field: "selected-year-discrepancy", severity: "WARNING" }],
  };
  db.tables.cross_document_validations.push(
    selected,
    { ...selected, id: "other-year", school_year: "2023-2024" },
    { ...selected, id: "other-grade", grade_level: "Grade 11" },
    { ...selected, id: "other-school", school_id: "school-2" },
    { ...selected, id: "other-section", section: "Emerald" },
    { ...selected, id: "other-student", student_id: "student-2" }
  );
  const persistedContext = {
    studentId: CONTEXT.studentId,
    schoolId: CONTEXT.schoolId,
    schoolYear: "2024-2025",
    gradeLevel: "Grade 12",
    section: CONTEXT.section,
  };
  const response = await fetchPersistedStudentValidation(db, persistedContext);
  assert.deepEqual(response.consolidated, selected);
  assert.deepEqual(response.matrix, selected.comparison_results);
  assert.deepEqual(response.discrepancies, selected.discrepancy_details);

  db.failure = { table: "cross_document_validations", action: "select" };
  await assert.rejects(
    () => fetchPersistedStudentValidation(db, persistedContext),
    /Failed to retrieve persisted validations/
  );
});

test("database persistence errors map to an unsuccessful API response", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  const records = await fetchStudentValidationRecords(db, CONTEXT);
  const evaluation = evaluateStudentValidation(CONTEXT, records);
  db.failure = { table: "cross_document_validations", action: "rpc" };

  await assert.rejects(() => persistStudentValidation(db, CONTEXT, evaluation), /simulated persistence failure/);
  const response = getPersistenceFailureResponse(new Error("Insert consolidated validation: simulated persistence failure"));
  assert.equal(response.status, 500);
  assert.match(response.body.error, /could not be saved/);

  const route = fs.readFileSync(path.join(ROOT, "src/app/api/validation/cross-document/route.ts"), "utf8");
  assert.match(route, /NextResponse\.json\(failureResponse\.body, \{ status: failureResponse\.status \}\)/);
  assert.match(route, /persistedValidations\.some\(\(row: any\) => row\.validation_type === "CONSOLIDATED_SHS"\)/);
  assert.match(route, /fieldsMatrix: persistedResponse\.matrix/);
  assert.doesNotMatch(route, /unifiedResult:\s*evaluation\.unifiedResult/);
  const batchRoute = fs.readFileSync(path.join(ROOT, "src/app/api/scan/batch/route.ts"), "utf8");
  assert.match(batchRoute, /buildPersistedValidationResponse\(persistedRows\)/);
  assert.match(batchRoute, /dossier\.unifiedMatrix = persistedValidation\.matrix/);
  assert.doesNotMatch(batchRoute, /dossier\.unifiedMatrix = fullEvaluation\.unifiedResult\.fieldsMatrix/);
});

test("read-after-write failures and absent persisted rows are explicit errors", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  const records = await fetchStudentValidationRecords(db, CONTEXT);
  const evaluation = evaluateStudentValidation(CONTEXT, records);

  db.failure = { table: "cross_document_validations", action: "select" };
  await assert.rejects(
    () => persistStudentValidation(db, CONTEXT, evaluation),
    /Retrieve persisted validation results: simulated persistence failure/
  );

  const emptyReadDb = makeDb();
  emptyReadDb.tables.sf1_roster_entries.push(sf1());
  emptyReadDb.emptyReadAfterRpc = true;
  const emptyReadRecords = await fetchStudentValidationRecords(emptyReadDb, CONTEXT);
  const emptyReadEvaluation = evaluateStudentValidation(CONTEXT, emptyReadRecords);
  await assert.rejects(
    () => persistStudentValidation(emptyReadDb, CONTEXT, emptyReadEvaluation),
    /one or more batch rows were not readable after persistence/
  );
});

test("a mid-batch persistence failure does not report or retain partial writes", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  db.tables.sf2_attendance_entries.push(sf2());
  const records = await fetchStudentValidationRecords(db, CONTEXT);
  const evaluation = evaluateStudentValidation(CONTEXT, records);
  const before = db.tables.cross_document_validations.map((row) => ({ ...row }));
  db.failure = {
    table: "cross_document_validations",
    action: "rpc",
    failAt: 2,
  };

  await assert.rejects(
    () => persistStudentValidation(db, CONTEXT, evaluation),
    /simulated mid-batch failure/
  );
  assert.equal(db.rpcCalls.length, 1, "One batch RPC carries all pairwise and consolidated rows.");
  assert.equal(db.rpcCalls[0].name, "persist_cross_document_validation_batch");
  assert.equal(db.rpcCalls[0].args.p_validations.length, evaluation.pairwiseResults.length + 1);
  assert.deepEqual(db.tables.cross_document_validations, before);
});

test("duplicate SF2 months are counted once and retain all source document IDs", () => {
  const identicalRecords = {
    sf1Entries: [],
    sf2Entries: [
      { ...sf2(), document_id: "sf2-aug-a" },
      { ...sf2(), id: "sf2-row-b", document_id: "sf2-aug-b" },
    ],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [],
    sf10Docs: [],
  };
  const identical = evaluateStudentValidation(CONTEXT, identicalRecords).unifiedResult;
  const monthly = identical.fieldsMatrix.find((row) => row.field === "attendance_august");
  const annual = identical.fieldsMatrix.find((row) => row.field === "attendance_annual_summary");
  assert.equal(annual.sf2Value, "Aggregated (1 unique months; conflicts excluded): Pres: 20, Abs: 1");
  assert.deepEqual(monthly.sourceDocumentIds.sort(), ["sf2-aug-a", "sf2-aug-b"]);

  const conflicting = evaluateStudentValidation(CONTEXT, {
    ...identicalRecords,
    sf2Entries: [
      identicalRecords.sf2Entries[0],
      { ...identicalRecords.sf2Entries[1], days_present: 19, days_absent: 2 },
    ],
  }).unifiedResult;
  const conflictMonth = conflicting.fieldsMatrix.find((row) => row.field === "attendance_august");
  const conflictAnnual = conflicting.fieldsMatrix.find((row) => row.field === "attendance_annual_summary");
  assert.equal(conflictMonth.status, "NEEDS_VERIFICATION");
  assert.match(conflictMonth.sf2Value, /sf2-aug-a/);
  assert.match(conflictMonth.sf2Value, /sf2-aug-b/);
  assert.equal(conflictAnnual.status, "NEEDS_VERIFICATION");
  assert.equal(conflictAnnual.sf2Value, undefined, "Conflicting month totals are excluded rather than combined.");
  assert.ok(conflicting.discrepancies.some((item) => item.field === "duplicate_sf2_attendance_aug"));
});

test("conflicting duplicate SF9 attendance values are flagged without annual double-counting", () => {
  const result = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [
      {
        id: "sf9-aug-a",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: {
          lrn: CONTEXT.lrn,
          attendance_months: ["August"],
          attendance: [
            { label: "No. of school days", values: [21] },
            { label: "No. of days present", values: [20] },
            { label: "No. of days absent", values: [1] },
          ],
        },
      },
      {
        id: "sf9-aug-b",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: {
          lrn: CONTEXT.lrn,
          attendance_months: ["August"],
          attendance: [
            { label: "No. of school days", values: [21] },
            { label: "No. of days present", values: [19] },
            { label: "No. of days absent", values: [2] },
          ],
        },
      },
    ],
    sf10Docs: [],
  }).unifiedResult;
  const month = result.fieldsMatrix.find((row) => row.field === "attendance_august");
  const annual = result.fieldsMatrix.find((row) => row.field === "attendance_annual_summary");
  assert.equal(month.status, "NEEDS_VERIFICATION");
  assert.match(month.sf9Value, /sf9-aug-a/);
  assert.match(month.sf9Value, /sf9-aug-b/);
  assert.equal(annual.status, "NEEDS_VERIFICATION");
  assert.ok(result.discrepancies.some((item) => item.field === "duplicate_sf9_attendance_aug"));
});

test("matching SF9 scalar values merge all source IDs without a false conflict", () => {
  const sf9Doc = (id, generalAverage) => ({
    id,
    school_id: CONTEXT.schoolId,
    school_year: CONTEXT.schoolYear,
    grade_level: CONTEXT.gradeLevel,
    section: CONTEXT.section,
    extracted_fields: {
      lrn: CONTEXT.lrn,
      general_average: generalAverage,
      sex: "F",
    },
  });
  const result = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [sf9Doc("sf9-scalar-a", 88), sf9Doc("sf9-scalar-b", "88.0")],
    sf10Docs: [],
  }).unifiedResult;
  const average = result.fieldsMatrix.find((row) => row.field === "general_average");
  const sex = result.fieldsMatrix.find((row) => row.field === "sex");

  assert.equal(average.status, "MATCH");
  assert.deepEqual(average.sourceDocumentIds.sort(), ["sf9-scalar-a", "sf9-scalar-b"]);
  assert.equal(sex.status, "MATCH");
  assert.deepEqual(sex.sourceDocumentIds.sort(), ["sf9-scalar-a", "sf9-scalar-b"]);
  assert.equal(result.discrepancies.some((item) => item.field === "conflicting_sf9_general_average"), false);
});

test("conflicting SF9 general averages require review with exact source IDs", () => {
  const result = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [
      {
        id: "sf9-average-a",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: { lrn: CONTEXT.lrn, general_average: 91 },
      },
      {
        id: "sf9-average-b",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: { lrn: CONTEXT.lrn, general_average: 76 },
      },
    ],
    sf10Docs: [],
  }).unifiedResult;
  const average = result.fieldsMatrix.find((row) => row.field === "general_average");

  assert.equal(average.status, "NEEDS_VERIFICATION");
  assert.equal(average.isMatch, false);
  assert.match(average.sf9Value, /91.*sf9-average-a/);
  assert.match(average.sf9Value, /76.*sf9-average-b/);
  assert.deepEqual(average.sourceDocumentIds.sort(), ["sf9-average-a", "sf9-average-b"]);
  assert.equal(result.needsHumanReview, true);
  assert.ok(result.discrepancies.some((item) => item.field === "conflicting_sf9_general_average"));
});

test("conflicting SF10 scalar values require review and retain each contributing source", () => {
  const result = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [],
    sf10Docs: [
      {
        id: "sf10-scalar-a",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: { lrn: CONTEXT.lrn, general_average: 90, sex: "F" },
      },
      {
        id: "sf10-scalar-b",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: { lrn: CONTEXT.lrn, general_average: 80, sex: "M" },
      },
    ],
  }).unifiedResult;
  const average = result.fieldsMatrix.find((row) => row.field === "general_average");
  const sex = result.fieldsMatrix.find((row) => row.field === "sex");

  assert.equal(average.status, "NEEDS_VERIFICATION");
  assert.equal(sex.status, "NEEDS_VERIFICATION");
  assert.deepEqual(average.sourceDocumentIds.sort(), ["sf10-scalar-a", "sf10-scalar-b"]);
  assert.deepEqual(sex.sourceDocumentIds.sort(), ["sf10-scalar-a", "sf10-scalar-b"]);
  assert.ok(result.discrepancies.some((item) => item.field === "conflicting_sf10_general_average"));
  assert.ok(result.discrepancies.some((item) => item.field === "conflicting_sf10_sex"));
  assert.equal(result.needsHumanReview, true);
});

test("SF9 scalar comparison excludes records from another year, grade, section, or school", () => {
  const sf9Doc = (id, generalAverage, context = {}) => ({
    id,
    school_id: context.schoolId ?? CONTEXT.schoolId,
    school_year: context.schoolYear ?? CONTEXT.schoolYear,
    grade_level: context.gradeLevel ?? CONTEXT.gradeLevel,
    section: context.section ?? CONTEXT.section,
    extracted_fields: { lrn: CONTEXT.lrn, general_average: generalAverage },
  });
  const result = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [
      sf9Doc("sf9-valid-context", 88),
      sf9Doc("sf9-other-year", 20, { schoolYear: "2023-2024" }),
      sf9Doc("sf9-other-grade", 30, { gradeLevel: "Grade 12" }),
      sf9Doc("sf9-other-section", 40, { section: "Other" }),
      sf9Doc("sf9-other-school", 50, { schoolId: "another-school" }),
    ],
    sf10Docs: [],
  }).unifiedResult;
  const average = result.fieldsMatrix.find((row) => row.field === "general_average");

  assert.equal(average.status, "MATCH");
  assert.deepEqual(average.sourceDocumentIds, ["sf9-valid-context"]);
  assert.equal(average.sf9Value, 88);
  assert.equal(result.needsHumanReview, false);
});

test("SF9/SF10 grade comparisons require matching school year, grade level, and semester", () => {
  const sf9Record = {
    raw: {
      lrn: CONTEXT.lrn,
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: CONTEXT.section,
      semester: "1st Semester",
      grades: [{ subject: "Oral Communication", final: 90 }],
    },
    documentId: "sf9-g11",
  };
  for (const sf10Record of [
    {
      raw: {
        lrn: CONTEXT.lrn,
        school_year: "2023-2024",
        grade_level: "Grade 11",
        section: CONTEXT.section,
        completed_semesters: [{
          school_year: "2023-2024",
          grade_level: "Grade 11",
          semester: "1st Semester",
          subjects: [{ subject: "Oral Communication", final_grade: 60 }],
        }],
      },
      documentId: "sf10-prior-year",
    },
    {
      raw: {
        lrn: CONTEXT.lrn,
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: CONTEXT.section,
        completed_semesters: [{
          school_year: "2024-2025",
          grade_level: "Grade 12",
          semester: "1st Semester",
          subjects: [{ subject: "Oral Communication", final_grade: 60 }],
        }],
      },
      documentId: "sf10-grade12",
    },
  ]) {
    const result = evaluateStudentValidation(CONTEXT, {
      sf1Entries: [],
      sf2Entries: [],
      sf5Entries: [],
      psaRecords: [],
      sf9Docs: [{
        id: "sf9-g11",
        school_id: CONTEXT.schoolId,
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: CONTEXT.section,
        extracted_fields: sf9Record.raw,
      }],
      sf10Docs: [{
        id: sf10Record.documentId,
        school_id: CONTEXT.schoolId,
        school_year: sf10Record.raw.school_year,
        grade_level: sf10Record.raw.grade_level,
        section: CONTEXT.section,
        extracted_fields: sf10Record.raw,
      }],
    });
    const gradeRow = result.unifiedResult.fieldsMatrix.find((row) => row.label === "Subject: Oral Communication");
    assert.equal(gradeRow.status, "NOT_APPLICABLE");
    assert.equal(gradeRow.sf10Value, undefined);
    assert.equal(result.unifiedResult.discrepancies.some((item) => item.field.startsWith("grade_")), false);
  }
});

test("SF10 completed_semesters grades participate in pairwise and consolidated comparisons", () => {
  const records = {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [{
      id: "sf9-current",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      extracted_fields: {
        lrn: CONTEXT.lrn,
        semester: "1st Semester",
        grades: [{ subject: "Oral Communication", final: 91 }],
      },
    }],
    sf10Docs: [{
      id: "sf10-cumulative",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      extracted_fields: {
        lrn: CONTEXT.lrn,
        completed_semesters: [{
          school_year: CONTEXT.schoolYear,
          grade_level: CONTEXT.gradeLevel,
          semester: "1st Semester",
          subjects: [{ subject: "Oral Communication", final_grade: 91 }],
        }],
      },
    }],
  };
  const evaluation = evaluateStudentValidation(CONTEXT, records);
  const pairwise = evaluation.pairwiseResults.find((row) => row.validationType === "SF9_SF10");
  const matrixGrade = evaluation.unifiedResult.fieldsMatrix.find((row) => row.label === "Subject: Oral Communication");
  assert.equal(pairwise.status, "MATCH");
  assert.equal(
    pairwise.comparisonResults.some((row) => row.field.toLowerCase().includes("oral communication") && row.isMatch),
    true,
    JSON.stringify(pairwise)
  );
  assert.equal(matrixGrade.status, "MATCH");
  assert.deepEqual(matrixGrade.sourceDocumentIds.sort(), ["sf10-cumulative", "sf9-current"]);
});

test("conflicting SF10 grades in the same academic context require review", () => {
  const result = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [{
      id: "sf9-grade",
      school_id: CONTEXT.schoolId,
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      section: CONTEXT.section,
      extracted_fields: {
        lrn: CONTEXT.lrn,
        semester: "1st Semester",
        grades: [{ subject: "Oral Communication", final: 91 }],
      },
    }],
    sf10Docs: [
      {
        id: "sf10-grade-a",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: {
          lrn: CONTEXT.lrn,
          semester: "1st Semester",
          grades: [{ subject: "Oral Communication", final_grade: 91 }],
        },
      },
      {
        id: "sf10-grade-b",
        school_id: CONTEXT.schoolId,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        section: CONTEXT.section,
        extracted_fields: {
          lrn: CONTEXT.lrn,
          semester: "1st Semester",
          grades: [{ subject: "Oral Communication", final_grade: 88 }],
        },
      },
    ],
  }).unifiedResult;
  const row = result.fieldsMatrix.find((item) => item.label === "Subject: Oral Communication");
  assert.equal(row.status, "NEEDS_VERIFICATION");
  assert.match(row.sf10Value, /91/);
  assert.match(row.sf10Value, /88/);
  assert.deepEqual(row.sourceDocumentIds.sort(), ["sf10-grade-a", "sf10-grade-b", "sf9-grade"]);
  assert.ok(result.discrepancies.some((item) => item.field === row.field && item.severity === "WARNING"));
});

test("legacy SF1/SF2 reads distinguish database failures from legitimate empty results", async () => {
  const emptyDb = makeDb();
  const empty = await fetchLegacySf1Sf2Entries(emptyDb, "sf1-empty", "sf2-empty");
  assert.deepEqual(empty, { sf1Entries: [], sf2Entries: [] });

  const failedEntryReadDb = makeDb();
  failedEntryReadDb.failure = { table: "sf1_roster_entries", action: "select" };
  await assert.rejects(
    () => fetchLegacySf1Sf2Entries(failedEntryReadDb, "sf1-failed", "sf2-empty"),
    /Failed to retrieve SF1 entries/
  );

  const failedFallbackReadDb = makeDb();
  failedFallbackReadDb.failure = { table: "documents", action: "select" };
  await assert.rejects(
    () => fetchLegacySf1Sf2Entries(failedFallbackReadDb, "sf1-empty", "sf2-empty"),
    /Failed to retrieve SF1 extracted fields/
  );

  const route = fs.readFileSync(path.join(ROOT, "src/app/api/validation/cross-document/route.ts"), "utf8");
  assert.match(route, /fetchLegacySf1Sf2Entries\(/);
  assert.match(route, /Cross-document validation execution failed/);
  assert.match(route, /NextResponse\.json\(\{ error: err\.message/);
});

test("unified and persisted rows retain exact page and row source traceability", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push({
    ...sf1(),
    page_number: 4,
    row_index: 8,
  });
  const records = await fetchStudentValidationRecords(db, CONTEXT);
  const evaluation = evaluateStudentValidation(CONTEXT, records);
  const nameRow = evaluation.unifiedResult.fieldsMatrix.find((row) => row.field === "last_name");
  assert.ok(nameRow);
  assert.ok(nameRow.sourceTraces.some((trace) =>
    trace.documentId === "doc-sf1" &&
    trace.documentType === "SF1-SHS" &&
    trace.fieldName === "last_name" &&
    trace.pageNumber === 4 &&
    trace.rowIndex === 8
  ));

  const saved = await persistStudentValidation(db, CONTEXT, evaluation);
  const consolidated = saved.find((row) => row.validation_type === "CONSOLIDATED_SHS");
  const persistedNameRow = consolidated.comparison_results.find((row) => row.field === "last_name");
  assert.ok(persistedNameRow.sourceTraces.some((trace) =>
    trace.documentId === "doc-sf1" && trace.pageNumber === 4 && trace.rowIndex === 8
  ));

  const hub = fs.readFileSync(path.join(ROOT, "src/components/validation/ShsConsolidatedValidationHub.tsx"), "utf8");
  assert.match(hub, /row\.sourceTraces\.map/);
  assert.match(hub, /trace\.pageNumber/);
  assert.match(hub, /trace\.rowIndex/);
});

test("SF9/SF10 semester records remain separate comparison contexts", () => {
  const document = (id, type, semester, average, grade) => ({
    id,
    school_id: CONTEXT.schoolId,
    school_year: CONTEXT.schoolYear,
    grade_level: CONTEXT.gradeLevel,
    section: CONTEXT.section,
    extracted_fields: {
      lrn: CONTEXT.lrn,
      semester,
      general_average: average,
      grades: [{
        subject: "Oral Communication",
        final: grade,
        final_grade: grade,
        semester,
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        page_number: semester === "1st Semester" ? 2 : 5,
        row_index: semester === "1st Semester" ? 3 : 7,
      }],
    },
  });
  const evaluation = evaluateStudentValidation(CONTEXT, {
    sf1Entries: [],
    sf2Entries: [],
    sf5Entries: [],
    psaRecords: [],
    sf9Docs: [
      document("sf9-semester-1", "sf9", "1st Semester", 90, 90),
      document("sf9-semester-2", "sf9", "2nd Semester", 85, 85),
    ],
    sf10Docs: [
      document("sf10-semester-1", "sf10", "1st Semester", 90, 90),
      document("sf10-semester-2", "sf10", "2nd Semester", 85, 85),
    ],
  }).unifiedResult;
  const average = evaluation.fieldsMatrix.find((row) => row.field === "general_average");
  const gradeRows = evaluation.fieldsMatrix.filter((row) => row.label === "Subject: Oral Communication");

  assert.equal(average.status, "MATCH");
  assert.match(average.sf9Value, /1st Semester/);
  assert.match(average.sf9Value, /2nd Semester/);
  assert.deepEqual(average.sourceDocumentIds.sort(), [
    "sf10-semester-1",
    "sf10-semester-2",
    "sf9-semester-1",
    "sf9-semester-2",
  ]);
  assert.equal(gradeRows.length, 2, "Each semester remains a distinct subject comparison row.");
  assert.ok(gradeRows.every((row) => row.status === "MATCH"));
  assert.equal(evaluation.discrepancies.some((item) => item.field.includes("semester")), false);
  assert.ok(gradeRows.some((row) => row.sourceTraces?.some((trace) =>
    trace.documentId === "sf9-semester-2" &&
    trace.pageNumber === 5 &&
    trace.rowIndex === 7 &&
    trace.academicContext?.semester === "2nd Semester"
  )));
});

test("invalid-LRN dossier cannot appear as successfully persisted while valid dossiers remain processable", () => {
  const segments = [
    { id: "seg-sf1", documentType: "sf1", pageNumbers: [1], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 1, endPage: 1, formTitle: "SF1", sourceFileName: "SF1.pdf" },
    { id: "seg-sf2", documentType: "sf2", pageNumbers: [2], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 2, endPage: 2, formTitle: "SF2", sourceFileName: "SF2.pdf" },
  ];
  const validLrn = "109345000001";
  const extractedData = {
    "seg-sf1": {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Diamond",
      learners: [
        { lrn: validLrn, last_name: "DELA CRUZ", first_name: "CARLOS", sex: "M" },
        { lrn: "INVALID-LRN", last_name: "UNKNOWN", first_name: "STUDENT", sex: "F" },
      ],
    },
    "seg-sf2": {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Diamond",
      month: "August",
      attendance: [
        { lrn: validLrn, learner_name: "DELA CRUZ, CARLOS", days_present: 20, days_absent: 0 },
      ],
    },
  };

  const report = evaluateBatchCrossDocumentValidation({
    batchId: "test-batch-1",
    schoolYear: "2024-2025",
    gradeLevel: "Grade 11",
    section: "Diamond",
    segments,
    extractedSegmentData: extractedData,
  });

  assert.equal(report.learnerDossiers.length, 2, "Both learners are detected.");
  const validDossier = report.learnerDossiers.find((d) => d.lrn === validLrn);
  const invalidDossier = report.learnerDossiers.find((d) => d.lrn !== validLrn);
  assert.ok(validDossier);
  assert.ok(invalidDossier);

  // Simulate persistence step: valid learner persists, invalid learner cannot persist
  validDossier.validationPersistence = {
    status: "PERSISTED",
    consolidatedValidationId: "val-row-001",
    persistedStatus: "MATCH",
  };
  validDossier.overallStatus = "MATCH";
  validDossier.persistedDiscrepancies = [];
  validDossier.documentPresence.totalAvailable = 2;
  validDossier.documentPresence.sf1 = true;
  validDossier.documentPresence.sf2 = true;

  invalidDossier.validationPersistence = {
    status: "REQUIRES_IDENTITY_RESOLUTION",
    reason: "Missing or invalid 12-digit LRN prevents database persistence and canonical student linking.",
    recommendedAction: "Resolve learner identity manually by inspecting original scanned document and assigning a valid 12-digit LRN.",
  };
  invalidDossier.overallStatus = "NEEDS_REVIEW";
  invalidDossier.unifiedMatrix = [];
  invalidDossier.persistedDiscrepancies = [];

  // Rebuild final report categories from persisted results
  rebuildBatchValidationReportFromPersistedResults(report);

  // Assertions:
  // 1. Invalid-LRN dossier cannot appear as successfully persisted
  assert.equal(invalidDossier.validationPersistence.status, "REQUIRES_IDENTITY_RESOLUTION");
  assert.notEqual(invalidDossier.validationPersistence.status, "PERSISTED");
  assert.deepEqual(invalidDossier.unifiedMatrix, [], "Computed matrix is withheld for unpersisted dossier.");
  assert.ok(
    invalidDossier.discrepancies.some((d) => d.field === "Learner Reference Number (LRN)" && d.category === "INCOMPLETE_DATA"),
    "Explicit actionable discrepancy for identity resolution is provided."
  );

  // 2. Valid dossiers remain processable when another dossier has an invalid LRN
  assert.equal(validDossier.validationPersistence.status, "PERSISTED");
  assert.equal(validDossier.overallStatus, "MATCH");

  // Categorized results & summary
  assert.ok(report.categorizedResults.successfullyMatched.some((d) => d.lrn === validLrn));
  assert.equal(report.categorizedResults.successfullyMatched.some((d) => d.lrn === invalidDossier.lrn), false);
  assert.ok(report.categorizedResults.requiresIdentityResolution.some((d) => d.lrn === invalidDossier.lrn));
  assert.equal(report.summary.identityResolutionRequiredCount, 1);
  assert.equal(report.summary.persistedValidationCount, 1);
  assert.equal(report.validationSource, "PERSISTED");
});

test("batch response discrepancy categories come from persisted results with no stale computed-only categories", () => {
  const report = {
    batchId: "batch-persisted-source",
    schoolYear: "2024-2025",
    gradeLevel: "Grade 11",
    section: "Diamond",
    summary: {
      totalLearnersDetected: 1,
      successfullyMatchedCount: 0,
      consistentRecordsCount: 0,
      mismatchedInformationCount: 99,
      missingDocumentsCount: 50,
      incompleteDataCount: 20,
      needsManualVerificationCount: 30,
    },
    categorizedResults: {
      successfullyMatched: [],
      consistentRecords: [],
      mismatchedInformation: [{ field: "stale_computed_mismatch", category: "MISMATCH" }],
      missingDocuments: [],
      incompleteData: [],
      needsManualVerification: [],
    },
    learnerDossiers: [
      {
        lrn: "109345000001",
        fullName: "Carlos Dela Cruz",
        overallStatus: "MISMATCH",
        documentPresence: {
          sf1: true, sf2: true, sf5: true, sf5a: true, sf5b: false, sf9: true, sf10: true, psa: true,
          sf2MonthsCount: 1, totalAvailable: 6,
        },
        matchedSources: {},
        pairwiseResults: [],
        discrepancies: [
          { id: "old-1", field: "stale_computed_mismatch", category: "MISMATCH", severity: "CRITICAL", reason: "old reason" },
        ],
        persistedDiscrepancies: [
          {
            field: "first_name",
            sourceValue: "CARLOS",
            targetValue: "CARLO",
            severity: "CRITICAL",
            description: "First name mismatch persisted in database.",
          },
          {
            field: "general_average",
            sourceValue: "90",
            targetValue: "88",
            severity: "WARNING",
            category: "NEEDS_VERIFICATION",
            description: "Semestral grade requires verification.",
          },
        ],
        unifiedMatrix: [{ field: "first_name", status: "MISMATCH" }],
        duplicateWarnings: [],
        validationPersistence: {
          status: "PERSISTED",
          consolidatedValidationId: "row-123",
          persistedStatus: "MISMATCH",
        },
      },
    ],
    segments: [],
  };

  rebuildBatchValidationReportFromPersistedResults(report);

  // Assertions: categories come strictly from persisted results
  assert.equal(report.validationSource, "PERSISTED");
  assert.equal(report.categorizedResults.mismatchedInformation.length, 1);
  assert.equal(report.categorizedResults.mismatchedInformation[0].field, "first_name");
  assert.equal(report.categorizedResults.mismatchedInformation[0].reason, "First name mismatch persisted in database.");

  assert.equal(report.categorizedResults.needsManualVerification.length, 1);
  assert.equal(report.categorizedResults.needsManualVerification[0].field, "general_average");

  // Stale categories are completely gone
  assert.equal(
    report.categorizedResults.mismatchedInformation.some((d) => d.field === "stale_computed_mismatch"),
    false,
    "No stale computed-only categories remain in the final response."
  );
  assert.equal(report.summary.mismatchedInformationCount, 1);
  assert.equal(report.summary.needsManualVerificationCount, 1);
  assert.equal(report.summary.missingDocumentsCount, 0);
  assert.equal(report.summary.incompleteDataCount, 0);
});

test("SF1–SF2 endpoint does not falsely imply persistence", () => {
  const sf1Entries = [
    { lrn: "109345000001", last_name: "DELA CRUZ", first_name: "CARLOS", sex: "M" },
  ];
  const sf2Entries = [
    { lrn: "109345000001", learner_name: "DELA CRUZ, CARLOS", days_present: 20, days_absent: 0 },
  ];

  const validation = compareSectionSf1AndSf2(sf1Entries, sf2Entries);
  assert.equal(validation.isPersisted, false, "Section validation defaults to isPersisted: false");
  assert.equal(validation.persistenceStatus, "COMPUTED_ONLY");

  const routeFile = fs.readFileSync(path.join(ROOT, "src/app/api/validation/cross-document/route.ts"), "utf8");
  assert.match(routeFile, /persisted:\s*false/);
  assert.match(routeFile, /persistenceStatus:\s*"COMPUTED_ONLY"/);
  assert.match(routeFile, /isPersisted:\s*false/);

  const viewFile = fs.readFileSync(path.join(ROOT, "src/components/validation/Sf1Sf2CrossValidationView.tsx"), "utf8");
  assert.match(viewFile, /On-Demand Audit \(Not Persisted\)/);
});

test("SF5A and SF5B either/or document completeness rules and grade-level applicability", () => {
  // 1. SF5A alone satisfies the required coverage
  const sf5aOnly = evaluateRequiredDocumentCoverage({
    sf1: true,
    sf2: true,
    sf5a: true,
    sf5b: false,
    sf9: true,
    sf10: true,
    psa: true,
  });
  assert.equal(sf5aOnly.sf5Satisfied, true, "SF5A alone satisfies the requirement.");
  assert.equal(sf5aOnly.totalRequired, 5);
  assert.equal(sf5aOnly.requiredAvailable, 5);
  assert.equal(sf5aOnly.hasRequiredCoverage, true);

  const sf5aChecklist = buildDocumentCompletenessChecklist({
    sf1: true, sf2: true, sf5a: true, sf5b: false, sf9: true, sf10: true, psa: true,
  });
  const sf5aItem = sf5aChecklist.items.find((i) => i.key === "sf5");
  assert.ok(sf5aItem);
  assert.equal(sf5aItem.present, true);
  assert.deepEqual(sf5aItem.satisfiedBy, ["SF5A-SHS"]);

  // 2. SF5B alone satisfies the required coverage
  const sf5bOnly = evaluateRequiredDocumentCoverage({
    sf1: true,
    sf2: true,
    sf5a: false,
    sf5b: true,
    sf9: true,
    sf10: true,
    psa: false,
  });
  assert.equal(sf5bOnly.sf5Satisfied, true, "SF5B alone satisfies the requirement.");
  assert.equal(sf5bOnly.totalRequired, 5);
  assert.equal(sf5bOnly.requiredAvailable, 5);
  assert.equal(sf5bOnly.hasRequiredCoverage, true);

  const sf5bChecklist = buildDocumentCompletenessChecklist({
    sf1: true, sf2: true, sf5a: false, sf5b: true, sf9: true, sf10: true, psa: false,
  });
  const sf5bItem = sf5bChecklist.items.find((i) => i.key === "sf5");
  assert.ok(sf5bItem);
  assert.equal(sf5bItem.present, true);
  assert.deepEqual(sf5bItem.satisfiedBy, ["SF5B-SHS"]);

  // 3. Neither SF5A nor SF5B is incomplete
  const neither = evaluateRequiredDocumentCoverage({
    sf1: true, sf2: true, sf5a: false, sf5b: false, sf9: true, sf10: true,
  });
  assert.equal(neither.sf5Satisfied, false);
  assert.equal(neither.requiredAvailable, 4);
  assert.equal(neither.hasRequiredCoverage, false);

  // 4. Grade-specific rules remain correct in unified engine:
  const gr11Context = {
    lrn: "109345000001",
    fullName: "Carlos Dela Cruz",
    studentId: "student-1",
    schoolId: "school-1",
    schoolYear: "2024-2025",
    gradeLevel: "Grade 11",
    section: "Diamond",
  };
  const gr11Eval = evaluateUnifiedStudentValidation({
    ...gr11Context,
    sf1: { raw: { lrn: gr11Context.lrn, grade_level: "Grade 11" } },
    sf5b: { raw: { lrn: gr11Context.lrn, grade_level: "Grade 11", graduation_status: "GRADUATED" } },
  });
  assert.ok(
    gr11Eval.discrepancies.some((d) => d.field === "grade_level_sf5b"),
    "Grade 11 learner with SF5B triggers grade_level_sf5b mismatch."
  );

  const gr12Context = {
    ...gr11Context,
    gradeLevel: "Grade 12",
  };
  const gr12Eval = evaluateUnifiedStudentValidation({
    ...gr12Context,
    sf1: { raw: { lrn: gr12Context.lrn, grade_level: "Grade 12" } },
    sf5b: { raw: { lrn: gr12Context.lrn, grade_level: "Grade 12", graduation_status: "GRADUATED" } },
  });
  assert.equal(
    gr12Eval.discrepancies.some((d) => d.field === "grade_level_sf5b"),
    false,
    "Grade 12 learner with SF5B is valid without grade_level_sf5b mismatch."
  );
});

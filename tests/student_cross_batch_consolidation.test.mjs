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
  persistStudentValidation,
} from "../src/lib/validation/studentCrossDocumentValidation.ts";
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
  }

  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  not() { return this; }
  or() { return this; }
  order() { return this; }
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

    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);
    const matching = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.action === "insert") {
      for (const payload of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        rows.push({ id: `row-${++this.db.nextId}`, created_at: new Date().toISOString(), ...payload });
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
    from(table) { return new MockQuery(this, table); },
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
});

test("teacher-resolved validation records and resolution metadata are preserved", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  db.tables.sf2_attendance_entries.push(sf2());
  const { evaluation } = await validateAndPersist(db);
  const pair = evaluation.pairwiseResults.find((row) => row.validationType === "SF1_SF2");
  const resolvedRow = {
    id: "resolved-pair",
    student_id: CONTEXT.studentId,
    school_id: CONTEXT.schoolId,
    school_year: CONTEXT.schoolYear,
    grade_level: pair.gradeLevel,
    semester: pair.semester,
    validation_type: pair.validationType,
    source_doc1_id: pair.sourceDoc1Id,
    source_doc2_id: pair.sourceDoc2Id,
    status: "RESOLVED",
    resolved_by: "teacher-1",
    resolved_at: "2024-09-01T08:00:00Z",
    resolution_notes: "Verified against signed attendance register",
  };
  db.tables.cross_document_validations = db.tables.cross_document_validations.filter(
    (row) => row.validation_type !== "SF1_SF2"
  );
  db.tables.cross_document_validations.push(resolvedRow);

  await persistStudentValidation(db, CONTEXT, evaluation);
  assert.deepEqual(db.tables.cross_document_validations.find((row) => row.id === "resolved-pair"), resolvedRow);
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
    { school_year: "2023-2024", grade_level: "Grade 11", section: "Emerald" },
    { school_year: "2024-2025", grade_level: "Grade 12", section: "Diamond", is_current: true, enrollment_status: "active" },
  ];
  const contexts = getStudentAcademicContexts(enrollments, [
    { school_year: "2025-2026", grade_level: "Grade 12", created_at: "latest" },
  ]);
  assert.deepEqual(
    chooseInitialStudentAcademicContext(enrollments, contexts),
    { schoolYear: "2024-2025", gradeLevel: "Grade 12", section: "Diamond" },
    "An active enrollment controls selection rather than the newest validation record."
  );
  assert.equal(chooseInitialStudentAcademicContext(enrollments.slice(0, 1), contexts.slice(0, 2)), null);
  assert.equal(
    buildPersistedValidationUrl("student-1", contexts[1]),
    "/api/validation/cross-document?studentId=student-1&schoolYear=2024-2025&gradeLevel=Grade+12"
  );
  assert.equal(
    getStudentAcademicContexts([
      { school_year: "2024-2025", grade_level: "Grade 12", section: "Diamond" },
      { school_year: "2024-2025", grade_level: "Grade 12", section: "Emerald" },
    ], []).length,
    2,
    "Distinct advisory assignments remain selectable."
  );

  const studentPage = fs.readFileSync(path.join(ROOT, "src/app/students/[id]/page.tsx"), "utf8");
  const hub = fs.readFileSync(path.join(ROOT, "src/components/validation/ShsConsolidatedValidationHub.tsx"), "utf8");
  assert.match(studentPage, /buildPersistedValidationUrl\(studentId, context\)/);
  assert.match(studentPage, /chooseInitialStudentAcademicContext\(json\.enrollments, contexts\)/);
  assert.match(studentPage, /initialValidationRecord=\{data\.validationRecord\}/);
  assert.match(hub, /activeValidationRecord\?\.comparison_results/);
  assert.match(hub, /activeValidationRecord\?\.discrepancy_details/);
  assert.match(hub, /schoolYear,/);
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/validation/cross-document/route.ts"), "utf8");
  assert.match(route, /const gradeLevel = searchParams\.get\("gradeLevel"\)/);
  assert.match(route, /fetchPersistedStudentValidation\(/);
  const validationService = fs.readFileSync(path.join(ROOT, "src/lib/validation/studentCrossDocumentValidation.ts"), "utf8");
  assert.match(validationService, /query = query\.eq\("grade_level", gradeLevel\)/);
});

test("persisted validation retrieval is constrained to the selected school year and grade", async () => {
  const db = makeDb();
  const selected = {
    id: "selected-context",
    student_id: CONTEXT.studentId,
    school_id: CONTEXT.schoolId,
    school_year: "2024-2025",
    grade_level: "Grade 12",
    validation_type: "CONSOLIDATED_SHS",
    comparison_results: [{ field: "selected-year-row" }],
    discrepancy_details: [{ field: "selected-year-discrepancy", severity: "WARNING" }],
  };
  db.tables.cross_document_validations.push(
    selected,
    { ...selected, id: "other-year", school_year: "2023-2024" },
    { ...selected, id: "other-grade", grade_level: "Grade 11" },
    { ...selected, id: "other-student", student_id: "student-2" }
  );
  const response = await fetchPersistedStudentValidation(db, CONTEXT.studentId, "2024-2025", "Grade 12");
  assert.deepEqual(response.consolidated, selected);
  assert.deepEqual(response.matrix, selected.comparison_results);
  assert.deepEqual(response.discrepancies, selected.discrepancy_details);

  db.failure = { table: "cross_document_validations", action: "select" };
  await assert.rejects(
    () => fetchPersistedStudentValidation(db, CONTEXT.studentId, "2024-2025", "Grade 12"),
    /Failed to retrieve persisted validations/
  );
});

test("database persistence errors map to an unsuccessful API response", async () => {
  const db = makeDb();
  db.tables.sf1_roster_entries.push(sf1());
  const records = await fetchStudentValidationRecords(db, CONTEXT);
  const evaluation = evaluateStudentValidation(CONTEXT, records);
  db.failure = { table: "cross_document_validations", action: "insert" };

  await assert.rejects(() => persistStudentValidation(db, CONTEXT, evaluation), /simulated persistence failure/);
  const response = getPersistenceFailureResponse(new Error("Insert consolidated validation: simulated persistence failure"));
  assert.equal(response.status, 500);
  assert.match(response.body.error, /could not be saved/);

  const route = fs.readFileSync(path.join(ROOT, "src/app/api/validation/cross-document/route.ts"), "utf8");
  assert.match(route, /NextResponse\.json\(failureResponse\.body, \{ status: failureResponse\.status \}\)/);
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
        extracted_fields: {
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
        extracted_fields: {
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

test("SF9/SF10 grade comparisons require matching school year, grade level, and semester", () => {
  const sf9Record = {
    raw: {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [{ subject: "Oral Communication", final: 90 }],
    },
    documentId: "sf9-g11",
  };
  for (const sf10Record of [
    {
      raw: {
        school_year: "2023-2024",
        grade_level: "Grade 11",
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
        school_year: "2024-2025",
        grade_level: "Grade 12",
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
      sf9Docs: [{ id: "sf9-g11", school_year: "2024-2025", grade_level: "Grade 11", extracted_fields: sf9Record.raw }],
      sf10Docs: [{ id: sf10Record.documentId, school_year: sf10Record.raw.school_year, grade_level: sf10Record.raw.grade_level, extracted_fields: sf10Record.raw }],
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
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      extracted_fields: {
        semester: "1st Semester",
        grades: [{ subject: "Oral Communication", final: 91 }],
      },
    }],
    sf10Docs: [{
      id: "sf10-cumulative",
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      extracted_fields: {
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
      school_year: CONTEXT.schoolYear,
      grade_level: CONTEXT.gradeLevel,
      extracted_fields: {
        semester: "1st Semester",
        grades: [{ subject: "Oral Communication", final: 91 }],
      },
    }],
    sf10Docs: [
      {
        id: "sf10-grade-a",
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        extracted_fields: {
          semester: "1st Semester",
          grades: [{ subject: "Oral Communication", final_grade: 91 }],
        },
      },
      {
        id: "sf10-grade-b",
        school_year: CONTEXT.schoolYear,
        grade_level: CONTEXT.gradeLevel,
        extracted_fields: {
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

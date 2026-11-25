import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  fetchStudentDetail,
  getStudentDetailErrorResponse,
  StudentDetailReadError,
} from "../src/lib/students/studentDetailService.ts";

const ROOT = process.cwd();
const COLLECTION_TABLES = [
  "student_enrollments",
  "documents",
  "sf1_roster_entries",
  "sf2_attendance_entries",
  "sf5_promotion_entries",
  "psa_identity_records",
  "subject_grades",
  "attendance_summaries",
  "cross_document_validations",
];

class MockQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
  }

  select() { return this; }
  eq(column, value) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  order() { return this; }
  or() { return this; }

  async execute() {
    if (this.db.failure?.table === this.table) {
      return { data: null, error: { message: "private database diagnostic" } };
    }
    const rows = this.db.tables[this.table] || [];
    return {
      data: rows.filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    };
  }

  async maybeSingle() {
    const result = await this.execute();
    return { data: result.data?.[0] || null, error: result.error };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

function makeDb() {
  return {
    failure: null,
    tables: {
      students: [{
        id: "student-1",
        school_id: "school-1",
        lrn: "109345000001",
        first_name: "Carlos",
        last_name: "Dela Cruz",
      }],
      ...Object.fromEntries(COLLECTION_TABLES.map((table) => [table, []])),
    },
    from(table) {
      return new MockQuery(this, table);
    },
  };
}

test("student detail reads return an error for every failed required query", async () => {
  for (const table of ["students", ...COLLECTION_TABLES]) {
    const db = makeDb();
    db.failure = { table };

    await assert.rejects(
      () => fetchStudentDetail(db, "student-1"),
      StudentDetailReadError,
      `${table} read failures must not become empty successful responses`
    );
  }

  const response = getStudentDetailErrorResponse();
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Failed to load student details." });

  const route = fs.readFileSync(path.join(ROOT, "src/app/api/students/[id]/route.ts"), "utf8");
  assert.match(route, /getStudentDetailErrorResponse\(\)/);
  assert.match(route, /NextResponse\.json\(response\.body, \{ status: response\.status \}\)/);
});

test("legitimately empty detail collections remain empty successful results", async () => {
  const detail = await fetchStudentDetail(makeDb(), "student-1");

  assert.ok(detail);
  assert.deepEqual(detail.enrollments, []);
  assert.deepEqual(detail.documents, []);
  assert.deepEqual(detail.rosters, { sf1: [], sf2: [], sf5: [], psa: [] });
  assert.deepEqual(detail.grades, []);
  assert.deepEqual(detail.attendance, []);
  assert.deepEqual(detail.cross_document_validations, []);
});

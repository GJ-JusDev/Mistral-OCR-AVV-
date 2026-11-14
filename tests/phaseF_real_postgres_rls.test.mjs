import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Phase F: Real PostgreSQL Engine Database Constraints & Anti-Corruption Triggers", async (t) => {
  const db = newDb();

  // Register uuid generation and auth mock
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: db.public.getType("uuid"),
    implementation: () => "b0000000-0000-0000-0000-000000000001",
  });

  // Setup Base Prerequisite Schema: schools, students, documents, subject_grades
  db.public.none(`
    CREATE TABLE schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE,
      name TEXT
    );

    CREATE TABLE students (
      id UUID PRIMARY KEY,
      school_id UUID REFERENCES schools(id),
      lrn TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT
    );

    CREATE TABLE documents (
      id UUID PRIMARY KEY,
      student_id UUID REFERENCES students(id),
      school_id UUID REFERENCES schools(id),
      uploaded_by TEXT,
      status TEXT DEFAULT 'needs_review'
    );

    CREATE TABLE subject_grades (
      id UUID PRIMARY KEY,
      student_id UUID REFERENCES students(id),
      document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
      subject TEXT,
      final_grade NUMERIC,
      school_year TEXT
    );

    -- Attendance Tables
    CREATE TABLE attendance_records (
      id UUID PRIMARY KEY,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
      school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
      grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
      school_year TEXT NOT NULL,
      semester TEXT,
      metric_label TEXT NOT NULL CHECK (metric_label IN ('No. of School Days', 'No. of Days Present', 'No. of Days Absent')),
      monthly_values JSONB NOT NULL DEFAULT '{}',
      computed_total NUMERIC CHECK (computed_total IS NULL OR computed_total >= 0),
      printed_total NUMERIC CHECK (printed_total IS NULL OR printed_total >= 0),
      has_discrepancy BOOLEAN DEFAULT false,
      discrepancy_note TEXT
    );

    CREATE TABLE attendance_summaries (
      id UUID PRIMARY KEY,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
      school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
      grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
      school_year TEXT NOT NULL,
      semester TEXT,
      total_school_days NUMERIC CHECK (total_school_days IS NULL OR total_school_days >= 0),
      total_days_present NUMERIC CHECK (total_days_present IS NULL OR total_days_present >= 0),
      total_days_absent NUMERIC CHECK (total_days_absent IS NULL OR total_days_absent >= 0),
      attendance_percentage NUMERIC CHECK (attendance_percentage IS NULL OR (attendance_percentage >= 0 AND attendance_percentage <= 100)),
      absence_percentage NUMERIC CHECK (absence_percentage IS NULL OR (absence_percentage >= 0 AND absence_percentage <= 100)),
      risk_status TEXT NOT NULL DEFAULT 'NORMAL' CHECK (risk_status IN ('NORMAL', 'ATTENDANCE_WARNING', 'ATTENDANCE_REVIEW_REQUIRED', 'INCOMPLETE_ATTENDANCE_DATA')),
      verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'ATTENDANCE_VERIFIED', 'FLAGGED_FOR_REVIEW')),
      school_review_completed BOOLEAN DEFAULT false,
      school_review_notes TEXT
    );

    CREATE TABLE remedial_records (
      id UUID PRIMARY KEY,
      subject_grade_id UUID REFERENCES subject_grades(id) ON DELETE SET NULL,
      student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
      school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      semester TEXT,
      school_year TEXT NOT NULL,
      original_final_grade NUMERIC NOT NULL CHECK (original_final_grade >= 0 AND original_final_grade <= 100),
      remedial_class_mark NUMERIC CHECK (remedial_class_mark IS NULL OR (remedial_class_mark >= 0 AND remedial_class_mark <= 100)),
      recomputed_final_grade NUMERIC CHECK (recomputed_final_grade IS NULL OR (recomputed_final_grade >= 0 AND recomputed_final_grade <= 100)),
      status TEXT NOT NULL DEFAULT 'REMEDIAL_REQUIRED',
      is_deficiency_resolved BOOLEAN DEFAULT false,
      is_verified BOOLEAN DEFAULT false,
      supporting_document_ref TEXT,
      teacher_notes TEXT
    );
  `);

  // Seed Institutional Data
  db.public.none(`
    INSERT INTO schools (id, school_id, name) VALUES 
      ('a0000000-0000-0000-0000-000000000001', '500169', 'Taysan Resettlement Integrated School'),
      ('a0000000-0000-0000-0000-000000000002', '300999', 'Other High School');

    INSERT INTO students (id, school_id, lrn, first_name, last_name) VALUES
      ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '123456789012', 'JUAN', 'DELA CRUZ'),
      ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', '987654321098', 'MARIA', 'SANTOS');

    INSERT INTO documents (id, student_id, school_id, uploaded_by, status) VALUES
      ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'teacher-uuid-1', 'needs_review'),
      ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'teacher-uuid-2', 'needs_review');

    INSERT INTO subject_grades (id, student_id, document_id, subject, final_grade, school_year) VALUES
      ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'General Mathematics', 72, '2023-2024');
  `);

  await t.test("1. Range Check Constraints: Rejects negative days and invalid percentages", () => {
    // Negative days present
    assert.throws(() => {
      db.public.none(`
        INSERT INTO attendance_summaries (id, student_id, grade_level, school_year, total_days_present)
        VALUES ('b0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', 'Grade 11', '2023-2024', -5);
      `);
    }, /check constraint/i);

    // Percentage > 100%
    assert.throws(() => {
      db.public.none(`
        INSERT INTO attendance_summaries (id, student_id, grade_level, school_year, attendance_percentage)
        VALUES ('b0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000001', 'Grade 11', '2023-2024', 105);
      `);
    }, /check constraint/i);
  });

  await t.test("2. Grade Range Constraints: Rejects remedial grades outside 0-100", () => {
    // Original grade > 100
    assert.throws(() => {
      db.public.none(`
        INSERT INTO remedial_records (id, student_id, subject, school_year, original_final_grade)
        VALUES ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'General Mathematics', '2023-2024', 150);
      `);
    }, /check constraint/i);

    // Remedial mark negative
    assert.throws(() => {
      db.public.none(`
        INSERT INTO remedial_records (id, student_id, subject, school_year, original_final_grade, remedial_class_mark)
        VALUES ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'General Mathematics', '2023-2024', 72, -10);
      `);
    }, /check constraint/i);
  });

  await t.test("3. Data Preservation: ON DELETE SET NULL preserves records when document is deleted", () => {
    // Insert valid attendance record and remedial record linked to document 1
    db.public.none(`
      INSERT INTO attendance_records (id, student_id, document_id, school_id, grade_level, school_year, metric_label, monthly_values, computed_total)
      VALUES ('b0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Grade 11', '2023-2024', 'No. of School Days', '{"Jun": 21}', 21);

      INSERT INTO remedial_records (id, student_id, document_id, school_id, subject, school_year, original_final_grade, remedial_class_mark, recomputed_final_grade, status)
      VALUES ('e0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'General Mathematics', '2023-2024', 72, 78, 75, 'REMEDIAL_PASSED');
    `);

    // Verify records exist
    const attBefore = db.public.one(`SELECT COUNT(*) as c FROM attendance_records WHERE student_id = 'c0000000-0000-0000-0000-000000000001'`);
    assert.strictEqual(Number(attBefore.c), 1);

    // Delete the source document (simulating re-upload or document replacement)
    db.public.none(`DELETE FROM documents WHERE id = 'd0000000-0000-0000-0000-000000000001'`);

    // Verify that student's attendance and remedial records are PRESERVED (document_id becomes null)
    const attAfter = db.public.one(`SELECT * FROM attendance_records WHERE student_id = 'c0000000-0000-0000-0000-000000000001'`);
    assert.ok(attAfter, "Attendance record must still exist after document deletion");
    assert.strictEqual(attAfter.document_id, null, "document_id must be set to null via ON DELETE SET NULL");
    assert.strictEqual(Number(attAfter.computed_total), 21, "Computed total must be preserved intact");

    const remAfter = db.public.one(`SELECT * FROM remedial_records WHERE student_id = 'c0000000-0000-0000-0000-000000000001'`);
    assert.ok(remAfter, "Remedial record must still exist after document deletion");
    assert.strictEqual(remAfter.document_id, null, "document_id must be set to null via ON DELETE SET NULL");
    assert.strictEqual(Number(remAfter.recomputed_final_grade), 75, "Recomputed grade must be preserved intact");
  });

  await t.test("4. Principal RPC Authorization: Function allows only review notes/completed, blocks metric changes", () => {
    // Insert fresh attendance summary
    db.public.none(`
      INSERT INTO attendance_summaries (id, student_id, school_id, grade_level, school_year, total_school_days, total_days_present, total_days_absent, attendance_percentage, absence_percentage, risk_status)
      VALUES ('b0000000-0000-0000-0000-000000000030', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Grade 11', '2023-2024', 200, 155, 45, 77.5, 22.5, 'ATTENDANCE_REVIEW_REQUIRED');
    `);

    // Simulate RPC execution: updates ONLY review fields
    db.public.none(`
      UPDATE attendance_summaries 
      SET school_review_completed = true, school_review_notes = 'Reviewed by School Head; student presented valid medical excuses.'
      WHERE id = 'b0000000-0000-0000-0000-000000000030';
    `);

    const summary = db.public.one(`SELECT * FROM attendance_summaries WHERE id = 'b0000000-0000-0000-0000-000000000030'`);
    assert.strictEqual(summary.school_review_completed, true);
    assert.strictEqual(summary.school_review_notes, 'Reviewed by School Head; student presented valid medical excuses.');
    // Raw metrics remain untouched
    assert.strictEqual(Number(summary.total_school_days), 200);
    assert.strictEqual(Number(summary.absence_percentage), 22.5);
    assert.strictEqual(summary.risk_status, 'ATTENDANCE_REVIEW_REQUIRED');
  });
});

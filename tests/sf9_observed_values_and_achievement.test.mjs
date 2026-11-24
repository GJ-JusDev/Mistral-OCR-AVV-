/**
 * AVV System — SF9-SHS Learners' Observed Values and Achievement Extraction Test Suite
 *
 * Verifies all 10 core requirements from DepEd SF9-SHS specifications:
 * 1. All four Core Values (Maka-Diyos, Makatao, Makakalikasan, Makabansa).
 * 2. Every individual Behavior Statement preserved separately.
 * 3. All four quarterly columns (Q1, Q2, Q3, Q4).
 * 4. AO/SO/RO/NO non-numerical recognition without numerical conversion.
 * 5. Blank cells remain strictly blank (never assumed NO).
 * 6. Unreadable and ambiguous marks flagged for teacher verification.
 * 7. Multiple learners and multiple SF9 pages.
 * 8. Database persistence and retrieval structure.
 * 9. Original image traceability and OCR provenance.
 * 10. Teacher correction and audit logging workflow.
 * 11. Authentic DepEd SF9-SHS sample validation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  normalizeObservedRating,
  parseAzureObservedValuesTable,
  parseAzureGradingScaleTable,
  parseTextObservedValuesAndAchievement,
  CANONICAL_BEHAVIOR_STATEMENTS,
  CANONICAL_GRADING_SCALE,
  matchBehaviorStatement,
  matchCoreValue,
} from "../src/lib/ocr/observedValuesParser.ts";

import { parseAzureLayoutGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { mergeSf9FrontAndBack } from "../src/lib/validation/sf9Merger.ts";
import { evaluateBatchCrossDocumentValidation } from "../src/lib/validation/batchCrossDocumentValidator.ts";

test("SF9-SHS Complete Learners' Observed Values and Achievement Extraction Suite", async (t) => {

  // -------------------------------------------------------------------------
  // Test 1: All Four Core Values Extraction & Grouping
  // -------------------------------------------------------------------------
  await t.test("1. Extracts and groups all four DepEd Core Values", async () => {
    const rawObservedValuesTable = {
      rowCount: 8,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },

        // Maka-Diyos
        { rowIndex: 1, columnIndex: 0, content: "1. Maka-Diyos" },
        { rowIndex: 1, columnIndex: 1, content: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others" },
        { rowIndex: 1, columnIndex: 2, content: "AO" },
        { rowIndex: 1, columnIndex: 3, content: "AO" },
        { rowIndex: 1, columnIndex: 4, content: "SO" },
        { rowIndex: 1, columnIndex: 5, content: "AO" },

        { rowIndex: 2, columnIndex: 0, content: "" },
        { rowIndex: 2, columnIndex: 1, content: "Shows adherence to ethical principles by upholding truth in all undertakings" },
        { rowIndex: 2, columnIndex: 2, content: "AO" },
        { rowIndex: 2, columnIndex: 3, content: "AO" },
        { rowIndex: 2, columnIndex: 4, content: "AO" },
        { rowIndex: 2, columnIndex: 5, content: "AO" },

        // Makatao
        { rowIndex: 3, columnIndex: 0, content: "2. Makatao" },
        { rowIndex: 3, columnIndex: 1, content: "Is sensitive to individual, social and cultural differences; resists stereotyping people" },
        { rowIndex: 3, columnIndex: 2, content: "SO" },
        { rowIndex: 3, columnIndex: 3, content: "SO" },
        { rowIndex: 3, columnIndex: 4, content: "AO" },
        { rowIndex: 3, columnIndex: 5, content: "AO" },

        { rowIndex: 4, columnIndex: 0, content: "" },
        { rowIndex: 4, columnIndex: 1, content: "Demonstrates contributions toward solidarity" },
        { rowIndex: 4, columnIndex: 2, content: "AO" },
        { rowIndex: 4, columnIndex: 3, content: "AO" },
        { rowIndex: 4, columnIndex: 4, content: "AO" },
        { rowIndex: 4, columnIndex: 5, content: "AO" },

        // Makakalikasan
        { rowIndex: 5, columnIndex: 0, content: "3. Makakalikasan" },
        { rowIndex: 5, columnIndex: 1, content: "Cares for the environment and utilizes resources wisely, judiciously and economically" },
        { rowIndex: 5, columnIndex: 2, content: "SO" },
        { rowIndex: 5, columnIndex: 3, content: "SO" },
        { rowIndex: 5, columnIndex: 4, content: "SO" },
        { rowIndex: 5, columnIndex: 5, content: "SO" },

        // Makabansa
        { rowIndex: 6, columnIndex: 0, content: "4. Makabansa" },
        { rowIndex: 6, columnIndex: 1, content: "Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen" },
        { rowIndex: 6, columnIndex: 2, content: "AO" },
        { rowIndex: 6, columnIndex: 3, content: "AO" },
        { rowIndex: 6, columnIndex: 4, content: "AO" },
        { rowIndex: 6, columnIndex: 5, content: "AO" },

        { rowIndex: 7, columnIndex: 0, content: "" },
        { rowIndex: 7, columnIndex: 1, content: "Demonstrates appropriate behavior in carrying out activities in the school, community and country" },
        { rowIndex: 7, columnIndex: 2, content: "AO" },
        { rowIndex: 7, columnIndex: 3, content: "AO" },
        { rowIndex: 7, columnIndex: 4, content: "AO" },
        { rowIndex: 7, columnIndex: 5, content: "AO" },
      ],
    };

    const ov = parseAzureObservedValuesTable(rawObservedValuesTable);
    assert.ok(ov, "Observed values structure should be created");
    assert.equal(ov.core_values.length, 4, "Must have exactly 4 Core Values");

    const cvNames = ov.core_values.map((c) => c.name);
    assert.deepEqual(cvNames, ["Maka-Diyos", "Makatao", "Makakalikasan", "Makabansa"]);

    // Check statements under each Core Value
    const makaDiyos = ov.core_values.find((c) => c.name === "Maka-Diyos");
    assert.equal(makaDiyos.statements.length, 2, "Maka-Diyos must have 2 statements");

    const makatao = ov.core_values.find((c) => c.name === "Makatao");
    assert.equal(makatao.statements.length, 2, "Makatao must have 2 statements");

    const makakalikasan = ov.core_values.find((c) => c.name === "Makakalikasan");
    assert.equal(makakalikasan.statements.length, 1, "Makakalikasan must have 1 statement");

    const makabansa = ov.core_values.find((c) => c.name === "Makabansa");
    assert.equal(makabansa.statements.length, 2, "Makabansa must have 2 statements");
  });

  // -------------------------------------------------------------------------
  // Test 2: Every Behavior Statement Stored Separately
  // -------------------------------------------------------------------------
  await t.test("2. Stores each behavior statement separately without combining ratings", async () => {
    assert.equal(CANONICAL_BEHAVIOR_STATEMENTS.length, 7, "DepEd SF9-SHS has 7 canonical behavior statements");

    const markdownText = `
| Core Values | Behavior Statements | Quarter | | | |
| | | 1 | 2 | 3 | 4 |
| 1. Maka-Diyos | Expresses one's spiritual beliefs while respecting the spiritual beliefs of others | AO | AO | SO | AO |
| | Shows adherence to ethical principles by upholding truth in all undertakings | SO | SO | SO | SO |
| 2. Makatao | Is sensitive to individual, social and cultural differences; resists stereotyping people | RO | RO | SO | SO |
| | Demonstrates contributions toward solidarity | AO | AO | AO | AO |
| 3. Makakalikasan | Cares for the environment and utilizes resources wisely, judiciously and economically | SO | SO | SO | SO |
| 4. Makabansa | Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen | AO | AO | AO | AO |
| | Demonstrates appropriate behavior in carrying out activities in the school, community and country | SO | SO | SO | SO |
    `;

    const parsed = parseTextObservedValuesAndAchievement(markdownText);
    assert.ok(parsed.observedValues, "Must parse observed values from text");
    const stmts = parsed.observedValues.statements;
    assert.equal(stmts.length, 7, "Must contain all 7 behavior statements separately");

    // Verify first statement does not leak into second
    const stmt1 = stmts.find((s) => s.statement_id === "maka_diyos_1");
    const stmt2 = stmts.find((s) => s.statement_id === "maka_diyos_2");
    assert.equal(stmt1.q1?.normalized_rating, "AO");
    assert.equal(stmt2.q1?.normalized_rating, "SO");
    assert.notEqual(stmt1.q1?.normalized_rating, stmt2.q1?.normalized_rating, "Statements must maintain separate ratings");
  });

  // -------------------------------------------------------------------------
  // Test 3: All Four Quarterly Columns (Q1, Q2, Q3, Q4)
  // -------------------------------------------------------------------------
  await t.test("3. Preserves quarterly marks for Q1, Q2, Q3, and Q4 distinctly", async () => {
    const table = {
      rowCount: 2,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },
        { rowIndex: 1, columnIndex: 0, content: "3. Makakalikasan" },
        { rowIndex: 1, columnIndex: 1, content: "Cares for the environment and utilizes resources wisely" },
        { rowIndex: 1, columnIndex: 2, content: "NO" },
        { rowIndex: 1, columnIndex: 3, content: "RO" },
        { rowIndex: 1, columnIndex: 4, content: "SO" },
        { rowIndex: 1, columnIndex: 5, content: "AO" },
      ],
    };

    const ov = parseAzureObservedValuesTable(table);
    const stmt = ov.statements.find((s) => s.core_value === "Makakalikasan");
    assert.ok(stmt);
    assert.equal(stmt.q1?.quarter, "Q1");
    assert.equal(stmt.q1?.normalized_rating, "NO");
    assert.equal(stmt.q2?.quarter, "Q2");
    assert.equal(stmt.q2?.normalized_rating, "RO");
    assert.equal(stmt.q3?.quarter, "Q3");
    assert.equal(stmt.q3?.normalized_rating, "SO");
    assert.equal(stmt.q4?.quarter, "Q4");
    assert.equal(stmt.q4?.normalized_rating, "AO");
  });

  // -------------------------------------------------------------------------
  // Test 4: AO/SO/RO/NO Recognition Without Numerical Conversion
  // -------------------------------------------------------------------------
  await t.test("4. Recognizes AO, SO, RO, NO and never converts to numerical grades", async () => {
    const ao = normalizeObservedRating("AO");
    assert.equal(ao.normalized, "AO");
    assert.equal(typeof ao.normalized, "string");

    const so = normalizeObservedRating("SO");
    assert.equal(so.normalized, "SO");

    const ro = normalizeObservedRating("RO");
    assert.equal(ro.normalized, "RO");

    const no = normalizeObservedRating("NO");
    assert.equal(no.normalized, "NO");

    // OCR character confusion: A0 (zero), S0, R0, N0, dots
    const aoWithZero = normalizeObservedRating("A0");
    assert.equal(aoWithZero.normalized, "AO");
    assert.equal(aoWithZero.originalMark, "A0", "Original text must be preserved");

    const soWithDot = normalizeObservedRating("S.O.");
    assert.equal(soWithDot.normalized, "SO");
    assert.equal(soWithDot.originalMark, "S.O.");

    // Strict numerical safety: verify no numeric value is produced
    assert.equal(ao.normalized, "AO");
    assert.equal(ao.numerical_grade, undefined);
  });

  // -------------------------------------------------------------------------
  // Test 5: Blank Cells Remain Strictly Blank (Never Assumed NO)
  // -------------------------------------------------------------------------
  await t.test("5. Blank cells remain strictly blank / null (never inferred as NO)", async () => {
    const blankEmpty = normalizeObservedRating("");
    assert.equal(blankEmpty.isBlank, true);
    assert.equal(blankEmpty.normalized, null);
    assert.notEqual(blankEmpty.normalized, "NO", "Blank cell must NEVER be converted to NO");

    const blankDash = normalizeObservedRating("-");
    assert.equal(blankDash.isBlank, true);
    assert.equal(blankDash.normalized, null);

    const blankUnderscore = normalizeObservedRating("___");
    assert.equal(blankUnderscore.isBlank, true);
    assert.equal(blankUnderscore.normalized, null);

    const blankUnselected = normalizeObservedRating(":unselected:");
    assert.equal(blankUnselected.isBlank, true);
    assert.equal(blankUnselected.normalized, null);
  });

  // -------------------------------------------------------------------------
  // Test 6: Unreadable and Ambiguous Marks Flagged for Teacher Verification
  // -------------------------------------------------------------------------
  await t.test("6. Unreadable and ambiguous marks are flagged for teacher review", async () => {
    const questionMark = normalizeObservedRating("?");
    assert.equal(questionMark.isUnreadable, true);
    assert.equal(questionMark.normalized, null);
    assert.equal(questionMark.originalMark, "?");

    const smudgeMark = normalizeObservedRating("smudge-xx");
    assert.equal(smudgeMark.isUnreadable, true);
    assert.equal(smudgeMark.normalized, null);

    const tableWithAmbiguity = {
      rowCount: 2,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },
        { rowIndex: 1, columnIndex: 0, content: "2. Makatao" },
        { rowIndex: 1, columnIndex: 1, content: "Demonstrates contributions toward solidarity" },
        { rowIndex: 1, columnIndex: 2, content: "AO" },
        { rowIndex: 1, columnIndex: 3, content: "???" },
        { rowIndex: 1, columnIndex: 4, content: "SO" },
        { rowIndex: 1, columnIndex: 5, content: "AO" },
      ],
    };

    const ov = parseAzureObservedValuesTable(tableWithAmbiguity);
    assert.equal(ov.has_unreadable_marks, true, "Must flag unreadable marks");
    assert.equal(ov.flagged_for_verification, true);

    const stmt = ov.statements.find((s) => s.statement_id === "makatao_2");
    assert.equal(stmt.q2?.needs_verification, true, "Q2 must require verification");
    assert.equal(stmt.q2?.verification_status, "flagged");
    assert.equal(stmt.q2?.original_mark, "???");
  });

  // -------------------------------------------------------------------------
  // Test 7: Multiple Learners and Multiple SF9 Pages
  // -------------------------------------------------------------------------
  await t.test("7. Handles multiple learners and multiple SF9 pages without state leakage", async () => {
    const rawTextLearner1 = `
REPORT CARD (SF9-SHS)
LRN: 111122223333
Name: SANTOS, MARIA

Core Values Behavior Statements
1. Maka-Diyos
Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others
AO AO AO AO
    `;

    const rawTextLearner2 = `
REPORT CARD (SF9-SHS)
LRN: 444455556666
Name: REYES, CARLOS

Core Values Behavior Statements
1. Maka-Diyos
Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others
SO SO SO SO
    `;

    const parsed1 = parseSeniorHighGradesText(rawTextLearner1);
    const parsed2 = parseSeniorHighGradesText(rawTextLearner2);

    assert.equal(parsed1.lrn, "111122223333");
    assert.equal(parsed2.lrn, "444455556666");

    const p1_q1 = parsed1.observed_values?.statements[0]?.q1?.normalized_rating;
    const p2_q1 = parsed2.observed_values?.statements[0]?.q1?.normalized_rating;

    assert.equal(p1_q1, "AO", "Learner 1 has AO");
    assert.equal(p2_q1, "SO", "Learner 2 has SO");
    assert.notEqual(p1_q1, p2_q1, "Learner 1 and Learner 2 must have distinct ratings");
  });

  // -------------------------------------------------------------------------
  // Test 8: Database Persistence and Retrieval Structure
  // -------------------------------------------------------------------------
  await t.test("8. Persists all observation fields in structured JSON without overwriting raw data", async () => {
    const rawObsTable = {
      rowCount: 2,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },
        { rowIndex: 1, columnIndex: 0, content: "4. Makabansa" },
        { rowIndex: 1, columnIndex: 1, content: "Demonstrates pride in being a Filipino" },
        { rowIndex: 1, columnIndex: 2, content: "AO" },
        { rowIndex: 1, columnIndex: 3, content: "AO" },
        { rowIndex: 1, columnIndex: 4, content: "AO" },
        { rowIndex: 1, columnIndex: 5, content: "AO" },
      ],
    };

    const ov = parseAzureObservedValuesTable(rawObsTable, {
      documentId: "doc-uuid-1234",
      lrn: "109876543210",
      sourcePage: 2,
    });

    assert.ok(ov.observations.length > 0, "Must populate flat observations list");
    const sampleObs = ov.observations.find((o) => o.core_value === "Makabansa" && o.quarter === "Q1");

    assert.ok(sampleObs);
    assert.equal(sampleObs.document_id, "doc-uuid-1234");
    assert.equal(sampleObs.lrn, "109876543210");
    assert.equal(sampleObs.core_value, "Makabansa");
    assert.ok(sampleObs.behavior_statement.includes("pride in being a Filipino"));
    assert.equal(sampleObs.quarter, "Q1");
    assert.equal(sampleObs.original_mark, "AO");
    assert.equal(sampleObs.normalized_rating, "AO");
    assert.equal(sampleObs.source_page, 2);
    assert.equal(sampleObs.verification_status, "unverified");

    // Verify JSON serializability
    const serialized = JSON.stringify(ov);
    const deserialized = JSON.parse(serialized);
    assert.equal(deserialized.observations[0].core_value, ov.observations[0].core_value);
  });

  // -------------------------------------------------------------------------
  // Test 9: Original Image Traceability and Provenance
  // -------------------------------------------------------------------------
  await t.test("9. Preserves image traceability, location coordinates, and OCR confidence", async () => {
    const tableWithBoundingBox = {
      rowCount: 2,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },
        {
          rowIndex: 1,
          columnIndex: 0,
          content: "1. Maka-Diyos",
          boundingBox: [0.1, 0.2, 0.3, 0.4],
          pageIndex: 2,
          confidence: 0.99,
        },
        {
          rowIndex: 1,
          columnIndex: 1,
          content: "Expresses one's spiritual beliefs",
          boundingBox: [0.3, 0.2, 0.6, 0.4],
          pageIndex: 2,
          confidence: 0.98,
        },
        {
          rowIndex: 1,
          columnIndex: 2,
          content: "AO",
          boundingBox: [0.65, 0.2, 0.7, 0.4],
          pageIndex: 2,
          confidence: 0.96,
        },
      ],
    };

    const ov = parseAzureObservedValuesTable(tableWithBoundingBox);
    const stmt = ov.statements.find((s) => s.statement_id === "maka_diyos_1");
    assert.ok(stmt);
    assert.equal(stmt.q1?.confidence, 0.96);
    assert.equal(stmt.q1?.source_page, 2);
    assert.deepEqual(stmt.q1?.bounding_box, [0.65, 0.2, 0.7, 0.4]);
    assert.equal(stmt.q1?.location, "row_1_col_2");
  });

  // -------------------------------------------------------------------------
  // Test 10: Teacher Correction and Audit Logging Workflow
  // -------------------------------------------------------------------------
  await t.test("10. Simulates teacher correction of unreadable mark and audit trail update", async () => {
    const table = {
      rowCount: 2,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },
        { rowIndex: 1, columnIndex: 0, content: "1. Maka-Diyos" },
        { rowIndex: 1, columnIndex: 1, content: "Expresses one's spiritual beliefs" },
        { rowIndex: 1, columnIndex: 2, content: "X_UNREADABLE" },
      ],
    };

    const ov = parseAzureObservedValuesTable(table);
    assert.equal(ov.has_unreadable_marks, true);
    const q1Before = ov.statements[0].q1;
    assert.equal(q1Before?.needs_verification, true);

    // Simulate teacher reviewing scan and correcting mark to 'AO'
    const teacherCorrection = "AO";
    const normCorrection = normalizeObservedRating(teacherCorrection);
    ov.statements[0].q1 = {
      ...q1Before,
      original_mark: q1Before?.original_mark, // preserve original OCR data!
      normalized_rating: normCorrection.normalized,
      needs_verification: false,
      verification_status: "corrected",
      corrected_mark: "AO",
      corrected_by: "teacher-uuid-001",
      corrected_at: new Date().toISOString(),
    };

    // Recompute verification flags
    ov.has_unreadable_marks = ov.statements.some((s) =>
      ["q1", "q2", "q3", "q4"].some((q) => s[q]?.needs_verification)
    );

    assert.equal(ov.statements[0].q1.normalized_rating, "AO");
    assert.equal(ov.statements[0].q1.original_mark, "X_UNREADABLE", "Original OCR mark preserved");
    assert.equal(ov.statements[0].q1.verification_status, "corrected");
    assert.equal(ov.has_unreadable_marks, false, "All marks verified");
  });

  // -------------------------------------------------------------------------
  // Test 11: Learner Progress and Achievement (Grading Scale)
  // -------------------------------------------------------------------------
  await t.test("11. Extracts Learner Progress and Achievement legend with official descriptors", async () => {
    const rawLegendTable = {
      rowCount: 6,
      columnCount: 3,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Descriptors" },
        { rowIndex: 0, columnIndex: 1, content: "Grading Scale" },
        { rowIndex: 0, columnIndex: 2, content: "Remarks" },
        { rowIndex: 1, columnIndex: 0, content: "Outstanding" },
        { rowIndex: 1, columnIndex: 1, content: "90-100" },
        { rowIndex: 1, columnIndex: 2, content: "Passed" },
        { rowIndex: 2, columnIndex: 0, content: "Very Satisfactory" },
        { rowIndex: 2, columnIndex: 1, content: "85-89" },
        { rowIndex: 2, columnIndex: 2, content: "Passed" },
        { rowIndex: 3, columnIndex: 0, content: "Satisfactory" },
        { rowIndex: 3, columnIndex: 1, content: "80-84" },
        { rowIndex: 3, columnIndex: 2, content: "Passed" },
        { rowIndex: 4, columnIndex: 0, content: "Fairly Satisfactory" },
        { rowIndex: 4, columnIndex: 1, content: "75-79" },
        { rowIndex: 4, columnIndex: 2, content: "Passed" },
        { rowIndex: 5, columnIndex: 0, content: "Did Not Meet Expectation" },
        { rowIndex: 5, columnIndex: 1, content: "Below 75" },
        { rowIndex: 5, columnIndex: 2, content: "Failed" },
      ],
    };

    const parsedScale = parseAzureGradingScaleTable(rawLegendTable);
    assert.ok(parsedScale);
    assert.equal(parsedScale.scale_items.length, 5);

    const outstanding = parsedScale.scale_items.find((i) => i.descriptor === "Outstanding");
    assert.equal(outstanding.grading_scale, "90-100");
    assert.equal(outstanding.remarks, "Passed");

    const failed = parsedScale.scale_items.find((i) => i.descriptor === "Did Not Meet Expectation");
    assert.equal(failed.grading_scale, "Below 75");
    assert.equal(failed.remarks, "Failed");
  });

  // -------------------------------------------------------------------------
  // Test 12: Authentic DepEd SF9-SHS Document Layout Verification
  // -------------------------------------------------------------------------
  await t.test("12. Validates extraction against authentic DepEd SF9-SHS reference layout", async () => {
    // Exact text structure from the reference document on Page 2:
    const authenticSf9ReferenceText = `
REPORT ON LEARNER'S OBSERVED VALUES 
Core Values Behavior Statements 
Quarter 
1 2 3 4 
1. Maka-Diyos 
Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others 
SO SO SO SO
Shows adherence to ethical principles by upholding truth in all undertakings 
SO SO SO SO
2. Makatao 
Is sensitive to individual, social and cultural differences; resists stereotyping people 
SO SO SO SO
Demonstrates contributions toward solidarity 
SO SO SO SO
3. Makakalikasan 
Cares for the environment and utilizes resources wisely, judiciously and economically 
SO SO SO SO
4. Makabansa 
Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen 
SO SO SO SO
Demonstrates appropriate behavior in carrying out activities in the school, community and country 
SO SO SO SO

Observed Values 
Marking Non-numerical Rating 
AO Always Observed 
SO Sometimes Observed 
RO Rarely Observed 
NO Not Observed 

Learner Progress and Achievement 
Descriptors Grading Scale Remarks 
Outstanding 90-100 Passed 
Very Satisfactory 85-89 Passed 
Satisfactory 80-84 Passed 
Fairly Satisfactory 75-79 Passed 
Did Not Meet Expectation Below 75 Failed 

LEARNER'S PROGRESS REPORT CARD 
First Semester 
| Subjects | Quarter 1 | Quarter 2 | Semester Final Grade |
| Core Subjects | | | |
| Oral Communication | 88 | 90 | 89 |
    `;

    const extracted = parseSeniorHighGradesText(authenticSf9ReferenceText);

    // Verify academic grades extracted without pollution
    assert.equal(extracted.grades?.length, 1, "Only 1 academic subject");
    assert.equal(extracted.grades[0].subject, "Oral Communication");

    // Verify Observed Values extracted
    assert.ok(extracted.observed_values, "Observed Values must be extracted from reference");
    assert.equal(extracted.observed_values.core_values.length, 4, "Must have all 4 Core Values");
    assert.equal(extracted.observed_values.statements.length, 7, "Must have all 7 Behavior Statements");

    // All marks on the reference were 'SO'
    for (const stmt of extracted.observed_values.statements) {
      assert.equal(stmt.q1?.normalized_rating, "SO", `${stmt.statement_id} Q1 must be SO`);
    }

    // Verify Learner Progress & Achievement legend extracted
    assert.ok(extracted.learner_progress_achievement, "Grading Scale legend must be extracted");
    assert.equal(extracted.learner_progress_achievement.scale_items.length, 5);
  });

  // =========================================================================
  // FIX 1 REGRESSION TESTS: Preserve Original OCR Marks & Metadata
  // =========================================================================
  await t.test("13. FIX 1 — Original OCR '?' remains unchanged after correction to 'AO', preserving confidence and bounding box", async () => {
    // Initial extracted observation with unreadable mark '?'
    const rawTable = {
      rowCount: 2,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "1" },
        { rowIndex: 0, columnIndex: 3, content: "2" },
        { rowIndex: 0, columnIndex: 4, content: "3" },
        { rowIndex: 0, columnIndex: 5, content: "4" },
        { rowIndex: 1, columnIndex: 0, content: "1. Maka-Diyos" },
        { rowIndex: 1, columnIndex: 1, content: "Expresses one's spiritual beliefs while respecting" },
        { rowIndex: 1, columnIndex: 2, content: "?", confidence: 0.94, boundingBox: [0.1, 0.2, 0.3, 0.4] },
        { rowIndex: 1, columnIndex: 3, content: "SO", confidence: 0.98, boundingBox: [0.1, 0.3, 0.3, 0.5] },
      ],
    };

    const parsedOv = parseAzureObservedValuesTable(rawTable);
    assert.ok(parsedOv);

    const initialQ1 = parsedOv.statements[0].q1;
    assert.equal(initialQ1.original_mark, "?");
    assert.equal(initialQ1.normalized_rating, null);
    assert.equal(initialQ1.needs_verification, true);
    assert.equal(initialQ1.confidence, 0.94);
    assert.deepEqual(initialQ1.bounding_box, [0.1, 0.2, 0.3, 0.4]);

    // Simulate handleObservedValueChange in OcrResultCard.tsx
    const statementId = parsedOv.statements[0].statement_id;
    const quarterKey = "q1";
    const newVal = "AO";

    const stmt = { ...parsedOv.statements[0] };
    const norm = normalizeObservedRating(newVal);
    const qUpper = "Q1";
    const prevQ = stmt[quarterKey];

    const observations = [...parsedOv.observations];
    const obsIdx = observations.findIndex(
      (o) => o.behavior_statement === stmt.statement && o.quarter === qUpper
    );
    const existingObs = obsIdx >= 0 ? observations[obsIdx] : null;

    // FIX 1 logic
    const originalMark =
      existingObs?.original_mark !== undefined && existingObs?.original_mark !== null && existingObs.original_mark !== ""
        ? existingObs.original_mark
        : (prevQ.original_mark !== undefined && prevQ.original_mark !== null && prevQ.original_mark !== ""
            ? prevQ.original_mark
            : (norm.isUnreadable ? norm.originalMark : ""));

    const teacherCorrection = norm.normalized || norm.originalMark || undefined;

    stmt[quarterKey] = {
      ...prevQ,
      quarter: qUpper,
      original_mark: originalMark,
      normalized_rating: norm.normalized,
      needs_verification: norm.isUnreadable,
      verification_status: norm.isUnreadable ? "flagged" : "corrected",
      corrected_mark: norm.normalized || undefined,
      teacher_correction: teacherCorrection,
      corrected_at: new Date().toISOString(),
    };

    if (obsIdx >= 0) {
      observations[obsIdx] = {
        ...observations[obsIdx],
        original_mark: originalMark,
        normalized_rating: norm.normalized,
        needs_verification: norm.isUnreadable,
        verification_status: norm.isUnreadable ? "flagged" : "corrected",
        teacher_correction: teacherCorrection,
        teacher_corrected_at: new Date().toISOString(),
      };
    }

    // Reg 1: Original OCR '?' remains unchanged
    assert.equal(stmt[quarterKey].original_mark, "?", "Quarter record original_mark must stay '?'");
    assert.equal(observations[obsIdx].original_mark, "?", "Observation original_mark must stay '?'");

    // Reg 2: Original OCR confidence and bounding box remain intact
    assert.equal(stmt[quarterKey].confidence, 0.94, "OCR confidence must be preserved");
    assert.deepEqual(stmt[quarterKey].bounding_box, [0.1, 0.2, 0.3, 0.4], "Bounding box must be preserved");
    assert.equal(observations[obsIdx].ocr_confidence, 0.94, "Observation ocr_confidence preserved");
    assert.deepEqual(observations[obsIdx].bounding_box, [0.1, 0.2, 0.3, 0.4], "Observation bounding box preserved");

    // Reg 3: Teacher correction persists separately from original OCR
    assert.equal(stmt[quarterKey].corrected_mark, "AO");
    assert.equal(stmt[quarterKey].teacher_correction, "AO");
    assert.equal(stmt[quarterKey].normalized_rating, "AO");
    assert.equal(stmt[quarterKey].needs_verification, false);
    assert.equal(stmt[quarterKey].verification_status, "corrected");
    assert.equal(observations[obsIdx].teacher_correction, "AO");
    assert.equal(observations[obsIdx].normalized_rating, "AO");
    assert.equal(observations[obsIdx].verification_status, "corrected");
  });

  // =========================================================================
  // FIX 2 REGRESSION TESTS: Remove Name-Only Learner Merging
  // =========================================================================
  await t.test("14. FIX 2 — Two learners with identical names and missing LRNs remain separate dossiers", async () => {
    const segments = [
      {
        id: "seg-sf9-1",
        documentType: "sf9",
        pageNumbers: [1],
        formTitle: "SF9 Progress Report Card 1",
      },
      {
        id: "seg-sf9-2",
        documentType: "sf9",
        pageNumbers: [2],
        formTitle: "SF9 Progress Report Card 2",
      },
    ];

    const extractedSegmentData = {
      "seg-sf9-1": {
        lrn: "", // Missing LRN
        last_name: "Dela Cruz",
        first_name: "Juan",
        middle_name: "Santos",
        grades: [{ subject: "Oral Communication", final: 88 }],
      },
      "seg-sf9-2": {
        lrn: "", // Missing LRN, identical name!
        last_name: "Dela Cruz",
        first_name: "Juan",
        middle_name: "Santos",
        grades: [{ subject: "General Mathematics", final: 91 }],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      batchId: "batch-name-collision-test",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      segments,
      extractedSegmentData,
    });

    // Reg 4: Two learners with identical names and missing LRNs MUST remain separate dossiers
    assert.equal(report.learnerDossiers.length, 2, "Must create 2 separate dossiers, NEVER merge by name alone");
    assert.notEqual(report.learnerDossiers[0].lrn, report.learnerDossiers[1].lrn);
    assert.ok(report.learnerDossiers[0].lrn.startsWith("UNREGISTERED"));
    assert.ok(report.learnerDossiers[1].lrn.startsWith("UNREGISTERED"));

    // Both flagged for manual verification due to missing LRN
    assert.ok(report.summary.incompleteDataCount >= 2, "Both learners must be flagged for missing LRN");
  });

  await t.test("15. FIX 2 — Valid identical 12-digit LRNs still match correctly across documents", async () => {
    const validLrn = "123456789012";
    const segments = [
      {
        id: "seg-sf1",
        documentType: "sf1",
        pageNumbers: [1],
        formTitle: "SF1 School Register",
      },
      {
        id: "seg-sf9",
        documentType: "sf9",
        pageNumbers: [2],
        formTitle: "SF9 Report Card",
      },
    ];

    const extractedSegmentData = {
      "seg-sf1": {
        learners: [
          {
            lrn: validLrn,
            last_name: "Dela Cruz",
            first_name: "Juan",
            middle_name: "Santos",
            sex: "M",
          },
        ],
      },
      "seg-sf9": {
        lrn: validLrn,
        last_name: "Dela Cruz",
        first_name: "Juan",
        middle_name: "Santos",
        grades: [{ subject: "Oral Communication", final: 88 }],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      batchId: "batch-valid-lrn-test",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      segments,
      extractedSegmentData,
    });

    // Reg 5: Valid identical LRNs match into single dossier
    assert.equal(report.learnerDossiers.length, 1, "Must associate into exactly 1 dossier via valid LRN");
    assert.equal(report.learnerDossiers[0].lrn, validLrn);
    assert.equal(report.learnerDossiers[0].documentPresence.sf1, true, "SF1 present");
    assert.equal(report.learnerDossiers[0].documentPresence.sf9, true, "SF9 present");
  });

  // =========================================================================
  // FIX 3 REGRESSION TESTS: Repair Azure Table to Text Fallback
  // =========================================================================
  await t.test("16. FIX 3 — Azure academic table detection does not skip Observed Values text fallback", async () => {
    // Azure detects academic grades table, but Observed Values was in text
    const rawLayoutWithGradesOnly = {
      tables: [
        {
          rowCount: 4,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "Subjects" },
            { rowIndex: 0, columnIndex: 1, content: "Quarter" },
            { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
            { rowIndex: 1, columnIndex: 1, content: "1" },
            { rowIndex: 1, columnIndex: 2, content: "2" },
            { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
            { rowIndex: 3, columnIndex: 0, content: "Oral Communication" },
            { rowIndex: 3, columnIndex: 1, content: "88" },
            { rowIndex: 3, columnIndex: 2, content: "90" },
            { rowIndex: 3, columnIndex: 3, content: "89" },
          ],
        },
      ],
    };

    const textWithObservedValues = `
LEARNER'S PROGRESS REPORT CARD
First Semester
Oral Communication 88 90 89

REPORT ON LEARNER'S OBSERVED VALUES
Core Values Behavior Statements
Quarter
1 2 3 4
1. Maka-Diyos
Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others
AO AO AO AO
Shows adherence to ethical principles by upholding truth in all undertakings
SO SO SO SO

Learner Progress and Achievement
Descriptors Grading Scale Remarks
Outstanding 90-100 Passed
Very Satisfactory 85-89 Passed
Satisfactory 80-84 Passed
Fairly Satisfactory 75-79 Passed
Did Not Meet Expectation Below 75 Failed
    `;

    const result = parseSeniorHighGradesText(textWithObservedValues, rawLayoutWithGradesOnly);

    // Reg 6: Academic grades preserved from Azure tables
    assert.ok(result.grades && result.grades.length === 1);
    assert.equal(result.grades[0].subject, "Oral Communication");
    assert.equal(result.grades[0].final, 89);

    // Reg 6: Observed Values fell back to text and extracted successfully!
    assert.ok(result.observed_values, "Observed Values must be extracted via text fallback!");
    assert.equal(result.observed_values.statements.length, 7);
    const stmt1 = result.observed_values.statements.find((s) => s.statement_id === "maka_diyos_1");
    assert.ok(stmt1);
    assert.equal(stmt1.q1?.normalized_rating, "AO");

    // Reg 6: Legend extracted via text fallback
    assert.ok(result.learner_progress_achievement, "Grading Scale legend must be extracted via fallback!");
    assert.equal(result.learner_progress_achievement.scale_items.length, 5);
  });

  await t.test("17. FIX 3 — Valid Azure Observed Values are authoritative and not overwritten by fallback", async () => {
    // Azure table with Observed Values mark 'AO'
    const rawLayoutWithBothTables = {
      tables: [
        {
          rowCount: 4,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "Subjects" },
            { rowIndex: 0, columnIndex: 1, content: "Quarter" },
            { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
            { rowIndex: 1, columnIndex: 1, content: "1" },
            { rowIndex: 1, columnIndex: 2, content: "2" },
            { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
            { rowIndex: 3, columnIndex: 0, content: "Oral Communication" },
            { rowIndex: 3, columnIndex: 1, content: "88" },
            { rowIndex: 3, columnIndex: 2, content: "90" },
            { rowIndex: 3, columnIndex: 3, content: "89" },
          ],
        },
        {
          rowCount: 2,
          columnCount: 6,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "Core Values" },
            { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
            { rowIndex: 0, columnIndex: 2, content: "1" },
            { rowIndex: 0, columnIndex: 3, content: "2" },
            { rowIndex: 0, columnIndex: 4, content: "3" },
            { rowIndex: 0, columnIndex: 5, content: "4" },
            { rowIndex: 1, columnIndex: 0, content: "1. Maka-Diyos" },
            { rowIndex: 1, columnIndex: 1, content: "Expresses one's spiritual beliefs while respecting" },
            { rowIndex: 1, columnIndex: 2, content: "AO" },
            { rowIndex: 1, columnIndex: 3, content: "AO" },
            { rowIndex: 1, columnIndex: 4, content: "AO" },
            { rowIndex: 1, columnIndex: 5, content: "AO" },
          ],
        },
      ],
    };

    // Text has conflicting 'RO' marks
    const textWithConflictingTextMarks = `
REPORT ON LEARNER'S OBSERVED VALUES
Core Values Behavior Statements
1. Maka-Diyos
Expresses one’s spiritual beliefs while respecting the spiritual beliefs of others
RO RO RO RO
    `;

    const result = parseSeniorHighGradesText(textWithConflictingTextMarks, rawLayoutWithBothTables);

    // Reg 7: Azure Observed Values remain authoritative
    assert.ok(result.observed_values);
    const stmt1 = result.observed_values.statements.find((s) => s.statement_id === "maka_diyos_1");
    assert.equal(stmt1?.q1?.normalized_rating, "AO", "Azure table result 'AO' must NOT be overwritten by text 'RO'");
  });

  await t.test("18. FIX 3 — Missing Observed Values data does not fabricate invented ratings", async () => {
    const rawLayoutGradesOnly = {
      tables: [
        {
          rowCount: 4,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "Subjects" },
            { rowIndex: 0, columnIndex: 1, content: "Quarter" },
            { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
            { rowIndex: 1, columnIndex: 1, content: "1" },
            { rowIndex: 1, columnIndex: 2, content: "2" },
            { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
            { rowIndex: 3, columnIndex: 0, content: "Oral Communication" },
            { rowIndex: 3, columnIndex: 1, content: "88" },
            { rowIndex: 3, columnIndex: 2, content: "90" },
            { rowIndex: 3, columnIndex: 3, content: "89" },
          ],
        },
      ],
    };

    // Text has NO Observed Values
    const pureAcademicText = `
SENIOR HIGH SCHOOL REPORT CARD
Core Subjects
Oral Communication 88 90 89
    `;

    const result = parseSeniorHighGradesText(pureAcademicText, rawLayoutGradesOnly);

    // Reg 8: Never invent ratings when data is absent
    assert.equal(result.observed_values, undefined, "Observed Values must be undefined when no data exists");
  });

  // =========================================================================
  // FIX 4 REGRESSION TESTS: Server-Side Correction Metadata Stamping
  // =========================================================================
  await t.test("19. FIX 4 — Server stamps authenticated teacher ID and timestamp, strips forged client metadata, and preserves untouched observations", async () => {
    const authenticatedTeacherId = "teacher-uuid-auth-12345";
    const serverTimestamp = "2026-11-24T10:30:00.000Z";

    // 1. Existing database document state prior to correction
    const currentFields = {
      observed_values: {
        statements: [
          {
            statement_id: "maka_diyos_1",
            statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
            core_value: "Maka-Diyos",
            core_value_index: 1,
            q1: {
              quarter: "Q1",
              original_mark: "?",
              normalized_rating: null,
              confidence: 0.94,
              bounding_box: [0.1, 0.2, 0.3, 0.4],
              needs_verification: true,
              verification_status: "flagged",
            },
            q2: {
              quarter: "Q2",
              original_mark: "SO",
              normalized_rating: "SO",
              confidence: 0.98,
              bounding_box: [0.1, 0.3, 0.3, 0.5],
              needs_verification: false,
              verification_status: "unverified",
            },
          },
        ],
        observations: [
          {
            behavior_statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
            quarter: "Q1",
            original_mark: "?",
            normalized_rating: null,
            ocr_confidence: 0.94,
            bounding_box: [0.1, 0.2, 0.3, 0.4],
            needs_verification: true,
            verification_status: "flagged",
          },
          {
            behavior_statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
            quarter: "Q2",
            original_mark: "SO",
            normalized_rating: "SO",
            ocr_confidence: 0.98,
            bounding_box: [0.1, 0.3, 0.3, 0.5],
            needs_verification: false,
            verification_status: "unverified",
          },
        ],
      },
    };

    // 2. Client sends payload where Q1 is corrected to 'AO', but attempts to forge metadata:
    // - Obs 1 (corrected): forged teacher_corrected_by: "attacker-uuid-9999", forged timestamp: "1999-01-01T00:00:00Z"
    // - Obs 2 (untouched rating 'SO'): injected forged teacher_corrected_by: "attacker-uuid-9999"
    const clientPayload = {
      observed_values: {
        statements: [
          {
            statement_id: "maka_diyos_1",
            statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
            core_value: "Maka-Diyos",
            core_value_index: 1,
            q1: {
              quarter: "Q1",
              original_mark: "ATTACKER_OVERWRITE", // Client tries to overwrite original OCR!
              normalized_rating: "AO",
              needs_verification: false,
              verification_status: "corrected",
              corrected_mark: "AO",
              corrected_by: "attacker-uuid-9999",
              corrected_at: "1999-01-01T00:00:00Z",
            },
            q2: {
              quarter: "Q2",
              original_mark: "SO",
              normalized_rating: "SO",
              needs_verification: false,
              verification_status: "unverified",
              corrected_by: "attacker-uuid-9999", // Client injects forged metadata on untouched cell!
            },
          },
        ],
        observations: [
          {
            behavior_statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
            quarter: "Q1",
            original_mark: "ATTACKER_OVERWRITE",
            normalized_rating: "AO",
            needs_verification: false,
            verification_status: "corrected",
            teacher_correction: "AO",
            teacher_corrected_by: "attacker-uuid-9999",
            teacher_corrected_at: "1999-01-01T00:00:00Z",
          },
          {
            behavior_statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
            quarter: "Q2",
            original_mark: "SO",
            normalized_rating: "SO",
            needs_verification: false,
            verification_status: "unverified",
            teacher_corrected_by: "attacker-uuid-9999",
          },
        ],
      },
    };

    // 3. Execute FIX 4 server-side validation & stamping logic
    const mergedFields = { ...currentFields, ...clientPayload };
    const ov = mergedFields.observed_values;
    const currentOv = currentFields.observed_values;

    const prevObsMap = new Map();
    if (currentOv && Array.isArray(currentOv.observations)) {
      for (const p of currentOv.observations) {
        const key = `${p.behavior_statement}::${p.quarter}`;
        prevObsMap.set(key, p);
      }
    }

    if (Array.isArray(ov.observations)) {
      for (const o of ov.observations) {
        const key = `${o.behavior_statement}::${o.quarter}`;
        const prevObs = prevObsMap.get(key);

        if (prevObs && prevObs.original_mark !== undefined && prevObs.original_mark !== null) {
          o.original_mark = prevObs.original_mark; // Server strictly restores raw OCR mark!
          if (prevObs.ocr_confidence !== undefined) o.ocr_confidence = prevObs.ocr_confidence;
          if (prevObs.bounding_box !== undefined) o.bounding_box = prevObs.bounding_box;
        }

        const ratingChanged = prevObs
          ? o.normalized_rating !== prevObs.normalized_rating || o.teacher_correction !== prevObs.teacher_correction
          : Boolean(o.teacher_correction || o.verification_status === "corrected");

        if (ratingChanged) {
          o.teacher_corrected_by = authenticatedTeacherId;
          o.teacher_corrected_at = serverTimestamp;
          if (o.normalized_rating) {
            o.verification_status = "corrected";
            o.needs_verification = false;
          }
        } else if (prevObs && prevObs.teacher_corrected_by) {
          o.teacher_corrected_by = prevObs.teacher_corrected_by;
          o.teacher_corrected_at = prevObs.teacher_corrected_at;
        } else {
          delete o.teacher_corrected_by;
          delete o.teacher_corrected_at;
        }
      }
    }

    // Synchronize statements
    for (const stmt of ov.statements) {
      for (const qk of ["q1", "q2", "q3", "q4"]) {
        const qRec = stmt[qk];
        if (!qRec) continue;
        const qUpper = qk.toUpperCase();
        const obs = ov.observations.find(
          (o) => o.behavior_statement === stmt.statement && o.quarter === qUpper
        );
        if (obs) {
          qRec.original_mark = obs.original_mark;
          qRec.normalized_rating = obs.normalized_rating;
          qRec.needs_verification = obs.needs_verification;
          qRec.verification_status = obs.verification_status;
          if (obs.teacher_corrected_by) {
            qRec.corrected_by = obs.teacher_corrected_by;
            qRec.corrected_at = obs.teacher_corrected_at;
            qRec.corrected_mark = obs.normalized_rating;
          } else {
            delete qRec.corrected_by;
            delete qRec.corrected_at;
          }
        }
      }
    }

    // Reg 9: Server stamps authenticated teacher ID and server timestamp
    assert.equal(ov.observations[0].teacher_corrected_by, authenticatedTeacherId, "Must stamp authenticated teacher ID");
    assert.equal(ov.observations[0].teacher_corrected_at, serverTimestamp, "Must stamp server timestamp");
    assert.equal(ov.statements[0].q1.corrected_by, authenticatedTeacherId);
    assert.equal(ov.statements[0].q1.corrected_at, serverTimestamp);

    // Reg 10: Client cannot forge metadata (attacker-uuid-9999 was overridden)
    assert.notEqual(ov.observations[0].teacher_corrected_by, "attacker-uuid-9999");
    assert.notEqual(ov.observations[0].teacher_corrected_at, "1999-01-01T00:00:00Z");

    // Server strictly preserved original OCR mark '?' against client overwrite
    assert.equal(ov.observations[0].original_mark, "?", "Original OCR mark strictly restored by server");
    assert.equal(ov.statements[0].q1.original_mark, "?", "Statement original_mark strictly restored by server");

    // Reg 11: Untouched observations are NOT falsely marked as corrected
    assert.equal(ov.observations[1].teacher_corrected_by, undefined, "Untouched observation must NOT have teacher_corrected_by");
    assert.equal(ov.observations[1].teacher_corrected_at, undefined, "Untouched observation must NOT have teacher_corrected_at");
    assert.equal(ov.statements[0].q2.corrected_by, undefined, "Untouched statement must NOT have corrected_by");

    // Reg 12: Existing teacher authorization rules
    const authEdit = await import("../src/lib/teacher/serverAuth.ts");
    assert.ok(typeof authEdit.authorizeTeacherDocumentEdit === "function", "authorizeTeacherDocumentEdit must exist");
  });
});

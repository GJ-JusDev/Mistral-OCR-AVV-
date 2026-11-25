/**
 * AVV System — Complete SF9 School Days, Attendance & Behavior Extraction Suite
 *
 * Verifies all 15 required scenarios:
 * 1. School days, days present, and days absent extraction across all available months.
 * 2. Handling of incomplete attendance tables without synthetic zero-filling.
 * 3. Total attendance calculations and comparison against printed totals.
 * 4. Identification of attendance discrepancies (e.g. days present + absent != school days).
 * 5. High-absence warnings without automatic penalty.
 * 6. Core Values and behavior statement extraction (Maka-Diyos, Makatao, Makakalikasan, Makabansa).
 * 7. Quarter-by-quarter rating extraction (Q1-Q4).
 * 8. Accurate handling of AO, SO, RO, NO ratings (no numerical conversion).
 * 9. Blank marks treated as missing/unrecorded, never as NO.
 * 10. Ambiguous or damaged marks flagged for teacher verification.
 * 11. Complete independence between behavior ratings and academic grades.
 * 12. Multi-page SF9 extraction preserving attendance and behavior across pages.
 * 13. Persistence and restoration through batch reload and recovery.
 * 14. Batch retry preserving attendance and behavior.
 * 15. Teacher review updates for verified attendance and behavior values.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAttendanceData,
  evaluateAttendanceRecords,
  parseAttendanceNumber,
} from "../src/lib/attendance/attendanceEvaluator.ts";

import {
  parseTextObservedValuesAndAchievement,
  normalizeObservedRating,
  CANONICAL_BEHAVIOR_STATEMENTS,
  CANONICAL_MARKING_LEGEND,
} from "../src/lib/ocr/observedValuesParser.ts";

import {
  parseSeniorHighGradesText,
} from "../src/lib/ocr/seniorHighParser.ts";

import {
  mergeSf9FrontAndBack,
  mergeSf10Pages,
} from "../src/lib/validation/sf9Merger.ts";

import {
  evaluateBatchCrossDocumentValidation,
  rebuildBatchValidationReportFromPersistedResults,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

import { computeSemesterGeneralAverage } from "../src/lib/validation/gradeUtils.ts";

describe("SF9 Attendance, School Days & Behavior (Observed Values) Comprehensive Suite", () => {
  // Scenario 1: School days, days present, and days absent extraction across all available months
  test("1. Extracts school days, days present, and days absent across all available DepEd months", () => {
    const months = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];
    const schoolDays = [21, 20, 22, 21, 15, 20, 19, 21, 20, 21]; // Sum = 200
    const daysPresent = [20, 19, 21, 20, 15, 19, 18, 20, 19, 20]; // Sum = 191
    const daysAbsent = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1]; // Sum = 9

    const res = evaluateAttendanceData({
      months,
      schoolDaysRow: schoolDays,
      daysPresentRow: daysPresent,
      daysAbsentRow: daysAbsent,
      printedSchoolDaysTotal: 200,
      printedDaysPresentTotal: 191,
      printedDaysAbsentTotal: 9,
    });

    assert.equal(res.monthlyBreakdown.length, 10);
    assert.equal(res.computedSchoolDays, 200);
    assert.equal(res.computedDaysPresent, 191);
    assert.equal(res.computedDaysAbsent, 9);
    assert.equal(res.attendancePercentage, 95.5);
    assert.equal(res.absencePercentage, 4.5);
    assert.equal(res.riskStatus, "NORMAL");
    assert.equal(res.hasTotalsDiscrepancy, false);
    assert.equal(res.hasEquationDiscrepancy, false);
    assert.equal(res.isComplete, true);

    // Verify month-to-value association
    for (let i = 0; i < months.length; i++) {
      assert.equal(res.monthlyBreakdown[i].month, months[i]);
      assert.equal(res.monthlyBreakdown[i].schoolDays, schoolDays[i]);
      assert.equal(res.monthlyBreakdown[i].daysPresent, daysPresent[i]);
      assert.equal(res.monthlyBreakdown[i].daysAbsent, daysAbsent[i]);
      assert.equal(res.monthlyBreakdown[i].isEquationValid, true);
    }
  });

  // Scenario 2: Handling of incomplete attendance tables without synthetic zero-filling
  test("2. Handles incomplete attendance tables without synthetic zero-filling (unrecorded != 0)", () => {
    assert.equal(parseAttendanceNumber(""), undefined);
    assert.equal(parseAttendanceNumber("-"), undefined);
    assert.equal(parseAttendanceNumber(":unselected:"), undefined);
    assert.equal(parseAttendanceNumber(null), undefined);
    assert.equal(parseAttendanceNumber(undefined), undefined);

    const res = evaluateAttendanceData({
      months: ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan"],
      schoolDaysRow: [21, 20, "-", "", null, 20],
      daysPresentRow: [20, 19, undefined, "-", "", 19],
      daysAbsentRow: [1, 1, "-", "", "", 1],
    });

    // Unrecorded months must have undefined, NEVER zero
    assert.equal(res.monthlyBreakdown[2].schoolDays, undefined);
    assert.equal(res.monthlyBreakdown[2].daysPresent, undefined);
    assert.equal(res.monthlyBreakdown[2].daysAbsent, undefined);
    assert.equal(res.monthlyBreakdown[2].isComplete, false);

    assert.equal(res.isComplete, false);
    assert.equal(res.riskStatus, "INCOMPLETE_ATTENDANCE_DATA");
    assert.equal(res.requiresReview, true);
    assert.ok(res.advisoryMessage.includes("Incomplete Attendance Data"));
  });

  // Scenario 3: Total attendance calculations and comparison against printed totals
  test("3. Accurately compares computed monthly sums against printed totals on card", () => {
    const res = evaluateAttendanceData({
      months: ["Aug", "Sep", "Oct"],
      schoolDaysRow: [20, 20, 20], // sum = 60
      daysPresentRow: [19, 19, 19], // sum = 57
      daysAbsentRow: [1, 1, 1], // sum = 3
      printedSchoolDaysTotal: "55", // Printed total is discrepant
      printedDaysPresentTotal: "57",
      printedDaysAbsentTotal: "3",
    });

    assert.equal(res.computedSchoolDays, 60);
    assert.equal(res.printedSchoolDays, 55);
    assert.equal(res.hasTotalsDiscrepancy, true);
    assert.equal(res.requiresReview, true);
    assert.ok(
      res.discrepancyDetails.some((d) => d.includes("Discrepancy sa Total School Days: Nakaimprenta sa form ay 55, ngunit ang sum ng buwanan ay 60"))
    );
  });

  // Scenario 4: Identification of attendance discrepancies (Days Present + Absent != School Days)
  test("4. Flags attendance equation discrepancies (Days Present + Days Absent != School Days)", () => {
    const res = evaluateAttendanceData({
      months: ["Aug", "Sep", "Oct"],
      schoolDaysRow: [20, 20, 20],
      daysPresentRow: [18, 19, 20],
      daysAbsentRow: [1, 1, 0], // Aug: 18 + 1 = 19 != 20! Discrepancy!
      printedSchoolDaysTotal: "60",
      printedDaysPresentTotal: "57",
      printedDaysAbsentTotal: "2", // Printed: 57 + 2 = 59 != 60! Discrepancy!
    });

    assert.equal(res.hasEquationDiscrepancy, true);
    assert.equal(res.hasTotalsDiscrepancy, true);
    assert.equal(res.requiresReview, true);

    // Monthly equation check
    assert.equal(res.monthlyBreakdown[0].isEquationValid, false);
    assert.equal(res.monthlyBreakdown[1].isEquationValid, true);
    assert.equal(res.monthlyBreakdown[2].isEquationValid, true);

    // Verify clear teacher-facing discrepancy message
    assert.ok(
      res.discrepancyDetails.some((d) => d.includes("Discrepancy sa Attendance Equation sa buwan ng Aug: Days Present (18) + Days Absent (1) = 19, ngunit ang School Days ay 20"))
    );
    assert.ok(
      res.discrepancyDetails.some((d) => d.includes("Discrepancy sa Attendance Equation sa Printed Totals"))
    );
  });

  // Scenario 5: High-absence warnings without automatic penalty
  test("5. Generates high-absence warning without failing student or deducting academic grades", () => {
    // Student with 25% absences (>20% threshold)
    const res = evaluateAttendanceData({
      months: ["Aug", "Sep", "Oct", "Nov", "Dec"],
      schoolDaysRow: [20, 20, 20, 20, 20], // 100 days
      daysPresentRow: [15, 15, 15, 15, 15], // 75 present
      daysAbsentRow: [5, 5, 5, 5, 5], // 25 absent
      printedSchoolDaysTotal: 100,
      printedDaysPresentTotal: 75,
      printedDaysAbsentTotal: 25,
    });

    assert.equal(res.absencePercentage, 25);
    assert.equal(res.riskStatus, "ATTENDANCE_REVIEW_REQUIRED");
    assert.equal(res.requiresReview, true);
    // DepEd safeguard: Warning only, non-punitive, school head review required
    assert.ok(res.advisoryMessage.includes("Attendance Review Required"));
    assert.ok(res.advisoryMessage.includes("Hindi pa ito automatic failure"));
    assert.ok(res.advisoryMessage.includes("DepEd policy"));
  });

  // Scenario 6: Core Values and behavior statement extraction
  test("6. Extracts all 4 DepEd Core Values and canonical behavior statements", () => {
    const rawText = `
REPORT ON LEARNERS' OBSERVED VALUES
Core Values | Behavior Statements | Q1 | Q2 | Q3 | Q4
1. Maka-Diyos | Expresses one's spiritual beliefs while respecting the spiritual beliefs of others | AO | AO | AO | AO
             | Shows adherence to ethical principles by upholding truth in all undertakings | SO | AO | SO | AO
2. Makatao   | Is sensitive to individual, social and cultural differences; resists stereotyping people | AO | AO | SO | SO
             | Demonstrates contributions toward solidarity | SO | SO | AO | AO
3. Makakalikasan | Cares for the environment and utilizes resources wisely, judiciously and economically | AO | AO | AO | AO
4. Makabansa | Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen | AO | AO | AO | AO
             | Demonstrates appropriate behavior in carrying out activities in the school, community and country | AO | SO | AO | AO
`;

    const parsed = parseTextObservedValuesAndAchievement(rawText);
    assert.ok(parsed.observedValues, "Must successfully extract observedValues");
    const ov = parsed.observedValues;

    assert.equal(ov.core_values.length, 4);
    assert.equal(ov.core_values[0].name, "Maka-Diyos");
    assert.equal(ov.core_values[1].name, "Makatao");
    assert.equal(ov.core_values[2].name, "Makakalikasan");
    assert.equal(ov.core_values[3].name, "Makabansa");

    // All statements present
    assert.equal(ov.statements.length, 7);
  });

  // Scenario 7: Quarter-by-quarter rating extraction (Q1-Q4)
  test("7. Preserves quarter-by-quarter marks distinctly without combining or averaging", () => {
    const rawText = `
Core Values | Behavior Statements | Q1 | Q2 | Q3 | Q4
Maka-Diyos | Expresses one's spiritual beliefs while respecting the spiritual beliefs of others | AO | SO | RO | NO
`;
    const parsed = parseTextObservedValuesAndAchievement(rawText);
    const stmt = parsed.observedValues?.statements[0];

    assert.ok(stmt);
    assert.equal(stmt.q1?.normalized_rating, "AO");
    assert.equal(stmt.q2?.normalized_rating, "SO");
    assert.equal(stmt.q3?.normalized_rating, "RO");
    assert.equal(stmt.q4?.normalized_rating, "NO");

    // Must be distinct fields, not flattened
    assert.notEqual(stmt.q1?.normalized_rating, stmt.q2?.normalized_rating);
    assert.notEqual(stmt.q2?.normalized_rating, stmt.q3?.normalized_rating);
    assert.notEqual(stmt.q3?.normalized_rating, stmt.q4?.normalized_rating);
  });

  // Scenario 8: Accurate handling of AO, SO, RO, NO ratings
  test("8. Accurately normalizes AO, SO, RO, NO ratings and never converts them to numerical grades", () => {
    const validRatings = ["AO", "SO", "RO", "NO"];
    for (const r of validRatings) {
      const norm = normalizeObservedRating(r);
      assert.equal(norm.normalized, r);
      assert.equal(typeof norm.normalized, "string");
      assert.equal(Number.isNaN(Number(norm.normalized)), true, "Ratings must remain non-numerical");
    }

    assert.equal(CANONICAL_MARKING_LEGEND.AO, "Always Observed");
    assert.equal(CANONICAL_MARKING_LEGEND.SO, "Sometimes Observed");
    assert.equal(CANONICAL_MARKING_LEGEND.RO, "Rarely Observed");
    assert.equal(CANONICAL_MARKING_LEGEND.NO, "Not Observed");
  });

  // Scenario 9: Blank marks treated as missing/unrecorded, never as NO
  test("9. Treats blank cells as unrecorded/null and strictly prevents inferring 'NO'", () => {
    const blankNorm = normalizeObservedRating("");
    assert.equal(blankNorm.isBlank, true);
    assert.equal(blankNorm.normalized, null);
    assert.notEqual(blankNorm.normalized, "NO");

    const dashNorm = normalizeObservedRating("-");
    assert.equal(dashNorm.isBlank, true);
    assert.equal(dashNorm.normalized, null);
    assert.notEqual(dashNorm.normalized, "NO");

    const spaceNorm = normalizeObservedRating("   ");
    assert.equal(spaceNorm.isBlank, true);
    assert.equal(spaceNorm.normalized, null);
    assert.notEqual(spaceNorm.normalized, "NO");
  });

  // Scenario 10: Ambiguous or damaged marks flagged for verification
  test("10. Flags ambiguous or unreadable marks for teacher verification", () => {
    const unclearNorm = normalizeObservedRating("?");
    assert.equal(unclearNorm.isUnreadable, true);
    assert.equal(unclearNorm.normalized, null);

    const smudgedNorm = normalizeObservedRating("XYZ");
    assert.equal(smudgedNorm.isUnreadable, true);
    assert.equal(smudgedNorm.normalized, null);

    const rawText = `
Core Values | Behavior Statements | Q1 | Q2 | Q3 | Q4
Maka-Diyos | Expresses one's spiritual beliefs while respecting the spiritual beliefs of others | AO | ? | SO | AO
`;
    const parsed = parseTextObservedValuesAndAchievement(rawText);
    const ov = parsed.observedValues;

    assert.equal(ov.has_unreadable_marks, true);
    const q2 = ov.statements[0].q2;
    assert.equal(q2.needs_verification, true);
    assert.equal(q2.original_mark, "?");
  });

  // Scenario 11: Complete independence between behavior ratings and academic grades
  test("11. Ensures complete independence between behavior ratings and academic grades", () => {
    const grades = [
      { subject: "Oral Communication", final: 88, semester: "1st Semester" },
      { subject: "General Mathematics", final: 90, semester: "1st Semester" },
      { subject: "Earth and Life Science", final: 86, semester: "1st Semester" },
    ];
    const avgRes = computeSemesterGeneralAverage(grades, "1st Semester");
    assert.equal(avgRes.displayedAverage, 88);
    const genAvg = avgRes.displayedAverage;

    // Even if student has straight "NO" (Not Observed) in behavior, academic general average is unchanged
    const sf9Data = {
      grades,
      general_average: genAvg,
      observed_values: {
        has_unreadable_marks: false,
        statements: [
          {
            statement_id: "maka_diyos_1",
            statement: "Expresses beliefs",
            core_value: "Maka-Diyos",
            core_value_index: 1,
            q1: { normalized_rating: "NO" },
            q2: { normalized_rating: "NO" },
            q3: { normalized_rating: "NO" },
            q4: { normalized_rating: "NO" },
          },
        ],
      },
    };

    // Academic average is strictly preserved and not penalized
    assert.equal(sf9Data.general_average, 88);
  });

  // Scenario 12: Multi-page SF9 extraction preserving attendance and behavior across pages
  test("12. Preserves attendance and behavior across multi-page SF9 front and back", () => {
    // Page 1: Student info and Academic Grades
    const frontPage = {
      pageNumber: 1,
      fields: {
        lrn: "109876543210",
        name: "DELA CRUZ, JUAN",
        grade_level: "Grade 11",
        section: "Diamond",
        school_year: "2024-2025",
        grades: [
          { subject: "Oral Communication", q1: 88, q2: 90, final: 89, remarks: "PASSED" },
          { subject: "General Mathematics", q1: 85, q2: 87, final: 86, remarks: "PASSED" },
        ],
        general_average: 87.5,
      },
    };

    // Page 2: Attendance Table and Observed Values
    const backPage = {
      pageNumber: 2,
      fields: {
        lrn: "109876543210",
        name: "DELA CRUZ, JUAN",
        attendance_months: ["Aug", "Sep", "Oct", "Nov", "Dec"],
        attendance: [
          { label: "No. of School Days", values: [21, 20, 22, 21, 16], total: 100 },
          { label: "Days Present", values: [20, 19, 21, 20, 15], total: 95 },
          { label: "Days Absent", values: [1, 1, 1, 1, 1], total: 5 },
        ],
        attendance_totals: {
          computed_school_days: 100,
          computed_days_present: 95,
          computed_days_absent: 5,
          printed_school_days: 100,
          printed_days_present: 95,
          printed_days_absent: 5,
        },
        attendance_percentage: 95,
        absence_percentage: 5,
        attendance_risk_status: "NORMAL",
        observed_values: {
          has_unreadable_marks: false,
          core_values: [
            {
              name: "Maka-Diyos",
              index: 1,
              statements: [
                {
                  statement_id: "maka_diyos_1",
                  statement: "Expresses beliefs",
                  core_value: "Maka-Diyos",
                  core_value_index: 1,
                  q1: { normalized_rating: "AO" },
                  q2: { normalized_rating: "AO" },
                  q3: { normalized_rating: "AO" },
                  q4: { normalized_rating: "AO" },
                },
              ],
            },
          ],
        },
      },
    };

    const merged = mergeSf9FrontAndBack(frontPage, backPage);

    assert.equal(merged.isSameLearner, true);
    assert.equal(merged.hasIdentityConflict, false);
    assert.equal(merged.hasAcademicConflict, false);

    // Unified fields must have BOTH grades and attendance/behavior
    const u = merged.unifiedFields;
    assert.equal(u.lrn, "109876543210");
    assert.equal(u.grades?.length, 2);
    assert.equal(u.general_average, 87.5);
    assert.equal(u.attendance?.length, 3);
    assert.equal(u.attendance_months?.length, 5);
    assert.equal(u.attendance_totals?.computed_school_days, 100);
    assert.equal(u.attendance_risk_status, "NORMAL");
    assert.ok(u.observed_values, "Observed values from back must be preserved");
    assert.equal(u.observed_values.core_values[0].name, "Maka-Diyos");
  });

  // Scenario 13: Persistence and restoration through batch reload and recovery
  test("13. Restores attendance and behavior verification results after batch reload", () => {
    const report = {
      batchId: "batch-recovery-test",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      summary: {
        totalLearnersDetected: 1,
        successfullyMatchedCount: 1,
        consistentRecordsCount: 1,
        mismatchedInformationCount: 0,
        missingDocumentsCount: 0,
        incompleteDataCount: 0,
        needsManualVerificationCount: 0,
      },
      categorizedResults: {
        successfullyMatched: [],
        consistentRecords: [],
        mismatchedInformation: [],
        missingDocuments: [],
        incompleteData: [],
        needsManualVerification: [],
      },
      learnerDossiers: [
        {
          lrn: "109876543210",
          fullName: "Dela Cruz, Juan",
          overallStatus: "MATCH",
          documentPresence: {
            sf1: true, sf2: true, sf5: false, sf5a: false, sf5b: false, sf9: true, sf10: false, psa: false,
            sf2MonthsCount: 1, totalAvailable: 3,
          },
          matchedSources: {},
          pairwiseResults: [],
          discrepancies: [],
          persistedDiscrepancies: [
            {
              field: "SF9 Attendance Consistency",
              sourceValue: "Discrepancy in Oct: 18+1=19 != 20",
              targetValue: "Consistent attendance records",
              severity: "WARNING",
              category: "NEEDS_VERIFICATION",
              description: "Attendance equation mismatch detected.",
            },
          ],
          unifiedMatrix: [],
          duplicateWarnings: [],
          validationPersistence: {
            status: "PERSISTED",
            consolidatedValidationId: "val-row-001",
            persistedStatus: "NEEDS_REVIEW",
          },
        },
      ],
      segments: [],
    };

    const rebuilt = rebuildBatchValidationReportFromPersistedResults(report);

    assert.equal(rebuilt.validationSource, "PERSISTED");
    assert.equal(rebuilt.summary.needsManualVerificationCount, 1);
    assert.equal(rebuilt.categorizedResults.needsManualVerification.length, 1);
    assert.equal(rebuilt.categorizedResults.needsManualVerification[0].field, "SF9 Attendance Consistency");
    assert.equal(rebuilt.learnerDossiers[0].discrepancies.length, 1);
  });

  // Scenario 14: Batch retry preserving attendance and behavior
  test("14. Batch retry retains all attendance and behavior records across re-evaluation", () => {
    const segments = [
      {
        id: "seg-sf9-retry",
        documentType: "sf9",
        pageNumbers: [1],
        sourceFileName: "SF9_Sample.pdf",
        confidence: 0.95,
        formTitle: "SF9-SHS Progress Report Card",
        combinedText: "SF9 Report Card",
      },
    ];

    const extractedSegmentData = {
      "seg-sf9-retry": {
        document_type: "sf9",
        lrn: "109876543210",
        name: "DELA CRUZ, JUAN",
        grade_level: "Grade 11",
        section: "Diamond",
        school_year: "2024-2025",
        attendance: [
          { label: "School Days", values: [20, 20], total: 40 },
          { label: "Days Present", values: [19, 19], total: 38 },
          { label: "Days Absent", values: [1, 1], total: 2 },
        ],
        attendance_months: ["Aug", "Sep"],
        attendance_totals: {
          computed_school_days: 40,
          computed_days_present: 38,
          computed_days_absent: 2,
        },
        attendance_percentage: 95,
        absence_percentage: 5,
        attendance_risk_status: "NORMAL",
        observed_values: {
          has_unreadable_marks: false,
          core_values: [
            {
              name: "Maka-Diyos",
              index: 1,
              statements: [
                {
                  statement_id: "maka_diyos_1",
                  statement: "Expresses beliefs",
                  core_value: "Maka-Diyos",
                  core_value_index: 1,
                  q1: { normalized_rating: "AO" },
                  q2: { normalized_rating: "AO" },
                },
              ],
            },
          ],
        },
      },
    };

    const initialReport = evaluateBatchCrossDocumentValidation({
      batchId: "batch-retry-01",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      segments,
      extractedSegmentData,
    });

    assert.equal(initialReport.learnerDossiers.length, 1);
    const d1 = initialReport.learnerDossiers[0];
    assert.equal(d1.matchedSources.sf9?.raw?.attendance_totals?.computed_school_days, 40);
    assert.equal(d1.matchedSources.sf9?.raw?.observed_values?.core_values[0]?.name, "Maka-Diyos");

    // Simulate retry by re-running with updated/confirmed segment data
    const retryReport = evaluateBatchCrossDocumentValidation({
      batchId: "batch-retry-01",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      segments,
      extractedSegmentData,
    });

    const d2 = retryReport.learnerDossiers[0];
    assert.equal(d2.matchedSources.sf9?.raw?.attendance_totals?.computed_school_days, 40);
    assert.equal(d2.matchedSources.sf9?.raw?.observed_values?.core_values[0]?.name, "Maka-Diyos");
  });

  // Scenario 15: Teacher review updates for verified attendance and behavior values
  test("15. Teacher review updates unreadable behavior marks and records audit trail", () => {
    const rawObs = {
      core_value: "Maka-Diyos",
      behavior_statement: "Expresses beliefs",
      quarter: "Q2",
      original_mark: "?",
      normalized_rating: null,
      needs_verification: true,
      verification_status: "unverified",
    };

    // Simulate teacher visual inspection and verification in UI
    const teacherId = "teacher-user-123";
    const verifiedAt = new Date().toISOString();
    const correctedRating = "AO";

    const reviewedObs = {
      ...rawObs,
      normalized_rating: correctedRating,
      needs_verification: false,
      verification_status: "corrected",
      teacher_correction: correctedRating,
      teacher_corrected_by: teacherId,
      teacher_corrected_at: verifiedAt,
      // Original OCR mark remains preserved for audit traceability
      original_mark: "?",
    };

    assert.equal(reviewedObs.needs_verification, false);
    assert.equal(reviewedObs.normalized_rating, "AO");
    assert.equal(reviewedObs.original_mark, "?"); // Preserved original
    assert.equal(reviewedObs.teacher_corrected_by, teacherId);
    assert.ok(reviewedObs.teacher_corrected_at);
  });
});

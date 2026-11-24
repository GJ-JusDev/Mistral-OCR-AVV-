import test from "node:test";
import assert from "node:assert/strict";

import {
  comparePsaAndSf1,
  compareSf1AndSf2,
  compareSf1AndSf5,
  compareSf1AndSf9,
  compareSf9AndSf10,
  compareSf5AndSf9,
  compareSf5AndSf10,
  evaluateConsolidatedShsStudent,
} from "../src/lib/validation/crossDocumentEngine.ts";

test("SHS Cross-Document Validation Engine Test Suite", async (t) => {

  await t.test("1. PSA_SF1: Civil Identity ↔ School Register Consistency", () => {
    // Exact match
    const psa1 = {
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      middle_name: "MENDOZA",
      suffix: "JR.",
      birth_date: "2007-05-15",
      sex: "M",
      document_id: "doc-psa-01",
    };
    const sf1Match = {
      last_name: "Dela Cruz",
      first_name: "Juan",
      middle_name: "Mendoza",
      suffix: "Jr.",
      birth_date: "2007-05-15",
      sex: "MALE",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      document_id: "doc-sf1-01",
    };
    const res1 = comparePsaAndSf1(psa1, sf1Match);
    assert.equal(res1.status, "MATCH");
    assert.equal(res1.needsHumanReview, false);
    assert.equal(res1.discrepancies.length, 0);

    // Mismatched surname (Civil registry conflict)
    const sf1NameConflict = {
      ...sf1Match,
      last_name: "Santos",
    };
    const resConflict = comparePsaAndSf1(psa1, sf1NameConflict);
    assert.equal(resConflict.status, "MISMATCH");
    assert.equal(resConflict.needsHumanReview, true);
    assert.ok(resConflict.discrepancies.some((d) => d.field === "last_name" && d.severity === "CRITICAL"));

    // Conflicting Date of Birth
    const sf1DobConflict = {
      ...sf1Match,
      birth_date: "2007-08-20",
    };
    const resDob = comparePsaAndSf1(psa1, sf1DobConflict);
    assert.equal(resDob.status, "MISMATCH");
    assert.ok(resDob.discrepancies.some((d) => d.field === "date_of_birth" && d.severity === "CRITICAL"));

    // Middle name discrepancy (Warning / Needs verification)
    const sf1MidDiff = {
      ...sf1Match,
      middle_name: "Aquino",
    };
    const resMid = comparePsaAndSf1(psa1, sf1MidDiff);
    assert.equal(resMid.status, "NEEDS_VERIFICATION");
    assert.ok(resMid.discrepancies.some((d) => d.field === "middle_name" && d.severity === "WARNING"));
  });

  await t.test("2. SF1_SF2: Enrollment ↔ Monthly Daily Attendance Reconciliation", () => {
    const sf1Learner = {
      lrn: "109345000001",
      last_name: "Dela Cruz",
      first_name: "Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "ABM-11A",
      document_id: "doc-sf1-01",
    };

    // Attendance reconciled
    const sf2Records = [
      {
        lrn: "109345000001",
        learner_name: "DELA CRUZ, Juan",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "ABM-11A",
        month: "September",
        total_school_days: 21,
        days_present: 20,
        days_absent: 1,
        days_tardy: 0,
        document_id: "doc-sf2-01",
      },
      {
        lrn: "109345000001",
        learner_name: "DELA CRUZ, Juan",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "ABM-11A",
        month: "October",
        total_school_days: 22,
        days_present: 22,
        days_absent: 0,
        days_tardy: 1,
        document_id: "doc-sf2-02",
      },
    ];

    const resMatch = compareSf1AndSf2(sf1Learner, sf2Records);
    assert.equal(resMatch.status, "MATCH");
    assert.equal(resMatch.needsHumanReview, false);

    // Sum plausibility violation (present 20 + absent 5 = 25 > 21)
    const sf2InvalidSum = [
      {
        ...sf2Records[0],
        total_school_days: 21,
        days_present: 20,
        days_absent: 5,
      },
    ];
    const resInvalidSum = compareSf1AndSf2(sf1Learner, sf2InvalidSum);
    assert.equal(resInvalidSum.status, "MISMATCH");
    assert.ok(resInvalidSum.discrepancies.some((d) => d.field === "attendance_reconciliation" && d.severity === "CRITICAL"));

    // Missing attendance entries for enrolled learner
    const resMissing = compareSf1AndSf2(sf1Learner, []);
    assert.equal(resMissing.status, "NEEDS_VERIFICATION");
    assert.equal(resMissing.needsHumanReview, true);
  });

  await t.test("3. SF1_SF5: Enrollment ↔ Promotion Status Verification", () => {
    const sf1Learner = {
      lrn: "109345000001",
      last_name: "Dela Cruz",
      first_name: "Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "ABM-11A",
      remarks_indicator: null,
      document_id: "doc-sf1-01",
    };

    const sf5Learner = {
      lrn: "109345000001",
      learner_name: "DELA CRUZ, Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "ABM-11A",
      action_taken: "COMPLETE",
      document_id: "doc-sf5-01",
    };

    // Matching promotion record
    const resMatch = compareSf1AndSf5(sf1Learner, sf5Learner);
    assert.equal(resMatch.status, "MATCH");

    // Enrolled learner missing from SF5 report
    const resMissing = compareSf1AndSf5(sf1Learner, null);
    assert.equal(resMissing.status, "MISMATCH");
    assert.equal(resMissing.needsHumanReview, true);
    assert.ok(resMissing.discrepancies.some((d) => d.field === "promotion_record"));

    // Section discrepancy
    const sf5WrongSec = {
      ...sf5Learner,
      section: "STEM-11B",
    };
    const resSec = compareSf1AndSf5(sf1Learner, sf5WrongSec);
    assert.equal(resSec.status, "DISCREPANCIES_FOUND");
    assert.ok(resSec.discrepancies.some((d) => d.field === "section"));
  });

  await t.test("4. SF1_SF9: School Register Enrollment ↔ Report Card Metadata", () => {
    const sf1Learner = {
      lrn: "109345000001",
      last_name: "Dela Cruz",
      first_name: "Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "ABM-11A",
      track: "Academic",
      strand: "ABM",
      document_id: "doc-sf1-01",
    };

    const sf9Doc = {
      lrn: "109345000001",
      last_name: "Dela Cruz",
      first_name: "Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "ABM-11A",
      track: "Academic",
      strand: "ABM",
      document_id: "doc-sf9-01",
    };

    const resMatch = compareSf1AndSf9(sf1Learner, sf9Doc);
    assert.equal(resMatch.status, "MATCH");

    // LRN conflict
    const sf9WrongLrn = {
      ...sf9Doc,
      lrn: "109345009999",
    };
    const resLrn = compareSf1AndSf9(sf1Learner, sf9WrongLrn);
    assert.equal(resLrn.status, "MISMATCH");
    assert.ok(resLrn.discrepancies.some((d) => d.field === "lrn"));
  });

  await t.test("5. SF9_SF10: Semestral Report Card ↔ Permanent Academic Record", () => {
    const sf9Data = {
      document_id: "doc-sf9-01",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      general_average: 89,
      grades: [
        { subject: "Oral Communication", quarter1: 88, quarter2: 90, finalGrade: 89 },
        { subject: "General Mathematics", quarter1: 86, quarter2: 88, finalGrade: 87 },
        { subject: "Earth and Life Science", quarter1: 90, quarter2: 92, finalGrade: 91 },
      ],
    };

    // Perfect match
    const sf10Match = {
      document_id: "doc-sf10-01",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      general_average: 89,
      grades: [
        { subject: "Oral Communication", finalGrade: 89 },
        { subject: "General Mathematics", finalGrade: 87 },
        { subject: "Earth and Life Science", finalGrade: 91 },
      ],
    };

    const resMatch = compareSf9AndSf10(sf9Data, sf10Match);
    assert.equal(resMatch.status, "MATCH");
    assert.equal(resMatch.discrepancies.length, 0);

    // Grade discrepancy: Oral Comm 89 on SF9 vs 85 on SF10
    const sf10GradeMismatch = {
      ...sf10Match,
      grades: [
        { subject: "Oral Communication", finalGrade: 85 },
        { subject: "General Mathematics", finalGrade: 87 },
        { subject: "Earth and Life Science", finalGrade: 91 },
      ],
    };
    const resGradeDiff = compareSf9AndSf10(sf9Data, sf10GradeMismatch);
    assert.equal(resGradeDiff.status, "MISMATCH");
    assert.ok(resGradeDiff.discrepancies.some((d) => d.field.includes("oral") && d.severity === "CRITICAL"));

    // Missing subject on SF10
    const sf10MissingSubject = {
      ...sf10Match,
      grades: [
        { subject: "Oral Communication", finalGrade: 89 },
      ],
    };
    const resMissing = compareSf9AndSf10(sf9Data, sf10MissingSubject);
    assert.equal(resMissing.status, "MISMATCH");
    assert.ok(resMissing.discrepancies.some((d) => d.field.includes("mathematics")));
  });

  await t.test("6. SF5_SF9: SF5A End-of-Semester Status ↔ Report Card Grades", () => {
    // Scenario A: COMPLETE status with all passing grades
    const sf5aComplete = {
      document_id: "doc-sf5-01",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      action_taken: "COMPLETE",
    };
    const passingGrades = [
      { subject: "Oral Communication", finalGrade: 85, schoolYear: "2024-2025", gradeLevel: "Grade 11", semester: "1st Semester" },
      { subject: "General Mathematics", finalGrade: 78, schoolYear: "2024-2025", gradeLevel: "Grade 11", semester: "1st Semester" },
    ];
    const resA = compareSf5AndSf9(sf5aComplete, passingGrades, "doc-sf9-01");
    assert.equal(resA.status, "MATCH");

    // Scenario B: SF5A says COMPLETE, but SF9 has a failing grade (72)
    const failingGrades = [
      { subject: "Oral Communication", finalGrade: 85, schoolYear: "2024-2025", gradeLevel: "Grade 11", semester: "1st Semester" },
      { subject: "General Mathematics", finalGrade: 72, schoolYear: "2024-2025", gradeLevel: "Grade 11", semester: "1st Semester" }, // Failed!
    ];
    const resB = compareSf5AndSf9(sf5aComplete, failingGrades, "doc-sf9-01");
    assert.equal(resB.status, "MISMATCH");
    assert.ok(resB.discrepancies.some((d) => d.field === "failing_subject_unaccounted"));

    // Scenario C: SF5A says INCOMPLETE and properly lists General Mathematics deficiency
    const sf5aIncomplete = {
      document_id: "doc-sf5-01",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      action_taken: "INCOMPLETE",
      incomplete_subjects: ["General Mathematics"],
    };
    const resC = compareSf5AndSf9(sf5aIncomplete, failingGrades, "doc-sf9-01");
    assert.equal(resC.status, "MATCH");

    // Scenario D: SF5A says INCOMPLETE but missed declaring failing subject
    const sf5aIncompleteMissed = {
      ...sf5aIncomplete,
      incomplete_subjects: ["Physical Education"], // Wrong subject declared!
    };
    const resD = compareSf5AndSf9(sf5aIncompleteMissed, failingGrades, "doc-sf9-01");
    assert.equal(resD.status, "MISMATCH");
    assert.ok(resD.discrepancies.some((d) => d.field === "undeclared_deficiency"));
  });

  await t.test("7. SF5_SF10: SF5B Graduation Clearance ↔ Cumulative Permanent Record", () => {
    const sf5bGraduating = {
      document_id: "doc-sf5b-01",
      school_year: "2024-2025",
      grade_level: "Grade 12",
      action_taken: "GRADUATING",
      honors: "With Honors",
    };

    // Full 4 completed semesters with 0 back-subjects
    const sf10CompleteTranscript = {
      document_id: "doc-sf10-01",
      completed_semesters: [
        { grade_level: "Grade 11", semester: "1st Semester", subjects: [] },
        { grade_level: "Grade 11", semester: "2nd Semester", subjects: [] },
        { grade_level: "Grade 12", semester: "1st Semester", subjects: [] },
        { grade_level: "Grade 12", semester: "2nd Semester", subjects: [] },
      ],
      has_unresolved_back_subjects: false,
    };

    const resMatch = compareSf5AndSf10(sf5bGraduating, sf10CompleteTranscript);
    assert.equal(resMatch.status, "MATCH");

    // Missing 2nd semester of Grade 12 on SF10
    const sf10MissingSemester = {
      document_id: "doc-sf10-01",
      completed_semesters: [
        { grade_level: "Grade 11", semester: "1st Semester", subjects: [] },
        { grade_level: "Grade 11", semester: "2nd Semester", subjects: [] },
        { grade_level: "Grade 12", semester: "1st Semester", subjects: [] },
      ],
      has_unresolved_back_subjects: false,
    };
    const resMissingSem = compareSf5AndSf10(sf5bGraduating, sf10MissingSemester);
    assert.equal(resMissingSem.status, "MISMATCH");
    assert.ok(resMissingSem.discrepancies.some((d) => d.field === "missing_prerequisite_semesters"));

    // Candidate has unresolved back-subject on SF10
    const sf10WithBackSubject = {
      ...sf10CompleteTranscript,
      has_unresolved_back_subjects: true,
      unresolved_subjects: ["General Mathematics (Grade 11 Sem 1)"],
    };
    const resBackSubject = compareSf5AndSf10(sf5bGraduating, sf10WithBackSubject);
    assert.equal(resBackSubject.status, "MISMATCH");
    assert.ok(resBackSubject.discrepancies.some((d) => d.field === "unresolved_back_subjects"));
  });

  await t.test("8. Consolidated SHS 360° Student Validation Summary", () => {
    // All matching results
    const perfectEval = evaluateConsolidatedShsStudent({
      studentId: "student-uuid-1",
      schoolId: "school-uuid-tris",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      documentPresence: {
        hasSf1: true,
        hasSf2: true,
        hasSf5: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
      },
      pairwiseResults: [
        { validationType: "PSA_SF1", status: "MATCH", needsHumanReview: false, schoolYear: "2024-2025", comparisonResults: [], discrepancies: [], summaryMessage: "OK" },
        { validationType: "SF1_SF2", status: "MATCH", needsHumanReview: false, schoolYear: "2024-2025", comparisonResults: [], discrepancies: [], summaryMessage: "OK" },
        { validationType: "SF1_SF5", status: "MATCH", needsHumanReview: false, schoolYear: "2024-2025", comparisonResults: [], discrepancies: [], summaryMessage: "OK" },
        { validationType: "SF1_SF9", status: "MATCH", needsHumanReview: false, schoolYear: "2024-2025", comparisonResults: [], discrepancies: [], summaryMessage: "OK" },
        { validationType: "SF9_SF10", status: "MATCH", needsHumanReview: false, schoolYear: "2024-2025", comparisonResults: [], discrepancies: [], summaryMessage: "OK" },
        { validationType: "SF5_SF9", status: "MATCH", needsHumanReview: false, schoolYear: "2024-2025", comparisonResults: [], discrepancies: [], summaryMessage: "OK" },
      ],
    });

    assert.equal(perfectEval.overallStatus, "MATCH");
    assert.equal(perfectEval.needsHumanReview, false);
    assert.equal(perfectEval.documentCompleteness.totalAvailable, 6);
    assert.equal(perfectEval.criticalDiscrepanciesCount, 0);

    // Evaluation with critical discrepancy
    const criticalEval = evaluateConsolidatedShsStudent({
      studentId: "student-uuid-1",
      schoolId: "school-uuid-tris",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      documentPresence: {
        hasSf1: true,
        hasSf2: true,
        hasSf5: true,
        hasSf9: true,
        hasSf10: false,
        hasPsa: true,
      },
      pairwiseResults: [
        {
          validationType: "SF5_SF9",
          status: "MISMATCH",
          needsHumanReview: true,
          schoolYear: "2024-2025",
          comparisonResults: [],
          discrepancies: [
            { field: "grade", sourceValue: 72, targetValue: "COMPLETE", severity: "CRITICAL", description: "Grade mismatch" },
          ],
          summaryMessage: "Mismatch found",
        },
      ],
    });

    assert.equal(criticalEval.overallStatus, "MISMATCH");
    assert.equal(criticalEval.needsHumanReview, true);
    assert.equal(criticalEval.criticalDiscrepanciesCount, 1);
  });
});

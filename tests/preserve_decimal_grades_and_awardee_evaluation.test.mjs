import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import {
  computeRawSemesterFinalGrade,
  computeOfficialSemesterFinalGrade,
  recalculateSubjectGradeStatus,
  computeSemesterGeneralAverage,
  formatDisplayedGrade,
  formatPreciseGrade,
} from "../src/lib/validation/gradeUtils.ts";

import {
  resolveAwardPolicy,
  evaluateStudentForAcademicAward,
  presentAwardeesAlphabetically,
  rankAwardees,
  extractStudentSurname,
  compareAwardeesAlphabetically,
} from "../src/lib/awards/awardeeEvaluator.ts";

// ==============================================================================
// VERIFICATION SUITE: AWARDEE POLICY COMPLIANCE, DECIMAL PRECISION & MIGRATION SAFETY
// ==============================================================================

test("SCENARIO 1: School Year-Based Award Policy Selection", () => {
  // Historical K-12 SHS (SY 2024-2025)
  const policy2024 = resolveAwardPolicy("2024-2025");
  assert.strictEqual(policy2024.policyVersion, "DO_36_S_2016");
  assert.strictEqual(policy2024.finalGradeFloor, 85);
  assert.strictEqual(policy2024.quarterlyGradeFloor, 80);
  assert.strictEqual(policy2024.allowThreeHonorTiers, true);
  assert.strictEqual(policy2024.prohibitsRanking, true);
  assert.strictEqual(policy2024.isProvisional, false);

  // Pandemic clarification period (SY 2020-2021)
  const policy2020 = resolveAwardPolicy("2020-2021");
  assert.strictEqual(policy2020.policyVersion, "DM_030_S_2021");
  assert.strictEqual(policy2020.finalGradeFloor, 85);
  assert.strictEqual(policy2020.quarterlyGradeFloor, 80);
  assert.strictEqual(policy2020.allowThreeHonorTiers, true);

  // Strengthened SHS Curriculum / Future SY 2026-2027 (Provisional)
  const policy2026 = resolveAwardPolicy("2026-2027");
  assert.strictEqual(policy2026.policyVersion, "DO_015_S_2026_PROVISIONAL");
  assert.strictEqual(policy2026.isProvisional, true, "Must be clearly isolated as provisional policy");
  assert.strictEqual(policy2026.finalGradeFloor, 80, "DO 015 final grade floor is 80");
  assert.strictEqual(policy2026.quarterlyGradeFloor, undefined, "DO 015 has no quarterly 85 restriction");
  assert.strictEqual(policy2026.allowThreeHonorTiers, false, "DO 015 uses single Academic Excellence Award");
});

test("SCENARIO 2: DO 36 Quarterly grade between 80 and 84 does NOT disqualify learner", () => {
  // Student with Q1=82, Q2=92 -> Final=87, Core 2=95, GA=91.0
  // Under DO 36: Quarterly floor is 80; final subject floor is 85.
  // Q1=82 is >= 80, Final=87 is >= 85 -> Learner IS ELIGIBLE!
  const candidate = {
    studentId: "stud-q82",
    lrn: "100000000001",
    studentName: "Juan Dela Cruz",
    gradeLevel: "Grade 11",
    schoolYear: "2024-2025",
    grades: [
      { subject: "General Mathematics", finalGrade: 87, q1: 82, q2: 92 },
      { subject: "Oral Communication", finalGrade: 95, q1: 94, q2: 96 },
    ], // GA = 91.00
  };

  const result = evaluateStudentForAcademicAward(candidate);
  assert.strictEqual(result.isEligibleForAward, true, "Quarterly grade of 82 (>= 80) must NOT disqualify learner");
  assert.strictEqual(result.award, "With Honors");
  assert.strictEqual(result.disqualificationReasons.length, 0);
});

test("SCENARIO 3: DO 36 Final subject grade below 85 disqualifies learner", () => {
  // Student with GA 91.50, but one subject final grade is 84 (< 85 floor)
  const candidate = {
    studentId: "stud-fin84",
    lrn: "100000000002",
    studentName: "Maria Santos",
    gradeLevel: "Grade 11",
    schoolYear: "2024-2025",
    grades: [
      { subject: "Core 1", finalGrade: 96, q1: 96, q2: 96 },
      { subject: "Core 2", finalGrade: 95, q1: 95, q2: 95 },
      { subject: "Core 3", finalGrade: 84, q1: 84, q2: 84 }, // Final grade 84 (< 85)
    ], // GA = 91.67
  };

  const result = evaluateStudentForAcademicAward(candidate);
  assert.strictEqual(result.isEligibleForAward, false, "Final grade of 84 (< 85) must disqualify under DO 36");
  assert.strictEqual(result.award, "None");
  assert.strictEqual(
    result.disqualificationReasons.some((r) => r.includes("< 85 minimum threshold")),
    true
  );
});

test("SCENARIO 4: DO 015 rules applied only when officially configured for SY 2026-2027+", () => {
  // Under DO 015, s. 2026: Final grade floor is 80 (not 85).
  // A student with final grade 82 is ELIGIBLE under DO 015 for Academic Excellence Award!
  const candidate = {
    studentId: "stud-2026",
    lrn: "100000000003",
    studentName: "Ana Reyes",
    gradeLevel: "Grade 11",
    schoolYear: "2026-2027",
    grades: [
      { subject: "Applied Subject 1", finalGrade: 98, q1: 98, q2: 98 },
      { subject: "Applied Subject 2", finalGrade: 82, q1: 80, q2: 84 }, // 82 is >= 80 floor
    ], // GA = 90.00
  };

  const result = evaluateStudentForAcademicAward(candidate);
  assert.strictEqual(result.isEligibleForAward, true, "Final grade 82 is >= 80 floor under DO 015");
  assert.strictEqual(result.award, "Academic Excellence Award");
  assert.strictEqual(result.isProvisionalPolicy, true, "Marked as provisional policy");
});

test("SCENARIO 5: Alphabetical awardee presentation within categories (Strictly by Surname)", () => {
  const candidates = [
    {
      studentId: "1",
      lrn: "111",
      studentName: "Santos, Maria",
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      preciseAverage: 96.00, // With High Honors
      grades: [{ subject: "Subject 1", finalGrade: 96, q1: 96, q2: 96 }],
    },
    {
      studentId: "2",
      lrn: "222",
      studentName: "Aquino, Benigno",
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      preciseAverage: 96.50, // With High Honors
      grades: [{ subject: "Subject 1", finalGrade: 96.5, q1: 96, q2: 97 }],
    },
    {
      studentId: "3",
      lrn: "333",
      studentName: "Cruz, Juan Dela",
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      preciseAverage: 97.00, // With High Honors
      grades: [{ subject: "Subject 1", finalGrade: 97, q1: 96, q2: 98 }],
    },
  ];

  const presented = presentAwardeesAlphabetically(candidates);

  assert.strictEqual(presented.length, 3);
  // All 3 students are in "With High Honors".
  // DepEd Mandate: Must be sorted ALPHABETICALLY by surname, NOT by average!
  // Surnames: Aquino, Cruz, Santos
  assert.strictEqual(presented[0].studentName, "Aquino, Benigno");
  assert.strictEqual(presented[1].studentName, "Cruz, Juan Dela");
  assert.strictEqual(presented[2].studentName, "Santos, Maria");

  // Every record has presentationOrder = 'alphabetical'
  assert.strictEqual(presented[0].presentationOrder, "alphabetical");
});

test("SCENARIO 6: No numeric ranks or decimal-based ordering within award category", () => {
  const candidates = [
    {
      studentId: "s1",
      lrn: "101",
      studentName: "Zarate, Pedro",
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      preciseAverage: 94.80, // Higher average in "With Honors"
      grades: [{ subject: "Subject 1", finalGrade: 94.8, q1: 94, q2: 95 }],
    },
    {
      studentId: "s2",
      lrn: "102",
      studentName: "Alvarez, Corazon",
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      preciseAverage: 90.50, // Lower average in "With Honors"
      grades: [{ subject: "Subject 1", finalGrade: 90.5, q1: 90, q2: 91 }],
    },
  ];

  const presented = rankAwardees(candidates); // Tests backward-compat wrapper

  // Alvarez (90.50) MUST appear before Zarate (94.80) because 'Alvarez' precedes 'Zarate' alphabetically!
  // DepEd DM 030, s. 2021 forbids using decimal differences to rank students!
  assert.strictEqual(presented[0].studentName, "Alvarez, Corazon");
  assert.strictEqual(presented[1].studentName, "Zarate, Pedro");

  // NO NUMERIC RANK (1st, 2nd) ASSIGNED
  assert.strictEqual(presented[0].rank, undefined, "Rank numbers must NOT be assigned");
  assert.strictEqual(presented[1].rank, undefined, "Rank numbers must NOT be assigned");

  // But precise averages remain available on each record for transcript and audit
  assert.strictEqual(presented[0].preciseAverage, 90.50);
  assert.strictEqual(presented[1].preciseAverage, 94.80);
});

test("SCENARIO 7: Exact decimal preservation in general average calculations (preciseAverage: preciseAvg)", () => {
  // 3 subjects: 85.5 + 86.5 + 85.8333 = 257.8333 / 3 = 85.9444...
  const grades = [
    { subject: "Subj 1", semester: "1st Semester", q1: 85, q2: 86 }, // raw: 85.5
    { subject: "Subj 2", semester: "1st Semester", q1: 86, q2: 87 }, // raw: 86.5
    { subject: "Subj 3", semester: "1st Semester", final: 85.8333 }, // raw: 85.8333
  ];

  const result = computeSemesterGeneralAverage(grades, "1st Semester");
  assert.strictEqual(result.completeness, "COMPLETE");
  // Proves the bug fix: preciseAverage must NOT be truncated to 2 decimals (85.94),
  // but must return the full 4-decimal precision (85.9444)
  assert.strictEqual(result.preciseAverage, 85.9444, "preciseAverage must preserve full 4 decimal places");
  assert.strictEqual(result.rawAverage, 85.94, "rawAverage is the 2-decimal rounded version");
  assert.strictEqual(result.displayedAverage, 86, "displayedAverage is the rounded whole number for SF9");
});

test("SCENARIO 8: Printed grade remains authoritative until teacher verification", () => {
  // Physical SF9 card has printed final grade of 85.
  // Extracted quarters Q1=80, Q2=84 produce an arithmetic average of 82 (discrepancy).
  const record = {
    subject: "Earth and Life Science",
    semester: "1st Semester",
    q1: 80,
    q2: 84,
    final: 85,
    printed_final_grade: 85,
    status: "Passed",
  };

  const processed = recalculateSubjectGradeStatus(record);

  // 1. Official printed grade is preserved without auto-overwriting
  assert.strictEqual(processed.final, 85);
  assert.strictEqual(processed.printed_final_grade, 85);
  assert.strictEqual(processed.has_calculation_discrepancy, true);
  assert.strictEqual(processed.needsVerification, true);
  assert.strictEqual(processed.precise_computed_grade, 82);

  // 2. computeSemesterGeneralAverage uses authoritative printed grade (85), NOT unverified 82!
  const avgResult = computeSemesterGeneralAverage([processed], "1st Semester");
  assert.strictEqual(avgResult.officialAverage, 85, "Official general average must use authoritative printed 85");
});

test("SCENARIO 9: Incomplete or unverified records cannot receive premature award decisions", () => {
  // Student has high average, but one subject has an unverified calculation discrepancy
  const candidate = {
    studentId: "stud-unverif",
    lrn: "100000000009",
    studentName: "Unverified Student",
    gradeLevel: "Grade 11",
    schoolYear: "2024-2025",
    grades: [
      { subject: "Core 1", finalGrade: 95, q1: 95, q2: 95, needsVerification: false },
      {
        subject: "Core 2",
        finalGrade: 92,
        q1: 86,
        q2: 90,
        has_calculation_discrepancy: true,
        needsVerification: true, // Pending human verification!
      },
    ],
  };

  const evaluation = evaluateStudentForAcademicAward(candidate);
  assert.strictEqual(evaluation.isEligibleForAward, false, "Must NOT confer award while discrepancies are unverified");
  assert.strictEqual(evaluation.award, "None");
  assert.strictEqual(
    evaluation.disqualificationReasons.some((r) => r.includes("Pending teacher verification")),
    true
  );
});

test("SCENARIO 10: PostgreSQL Engine Verification of Migration 027 (Audit Trails & Rollback Safety)", async () => {
  const db = new PGlite();

  // Create minimal schema mirroring production
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lrn TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      overall_status TEXT DEFAULT 'Passed'
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      semester TEXT,
      precise_general_average NUMERIC,
      displayed_general_average NUMERIC
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      document_id UUID REFERENCES public.documents(id),
      school_year TEXT NOT NULL,
      semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC,
      q2 NUMERIC,
      final_grade NUMERIC,
      precise_computed_grade NUMERIC,
      displayed_final_grade NUMERIC,
      printed_final_grade NUMERIC,
      ocr_final_grade NUMERIC,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS public.grade_change_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_grade_id UUID,
      student_id UUID,
      document_id UUID,
      school_year TEXT,
      quarter TEXT,
      previous_value NUMERIC,
      new_value NUMERIC,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.academic_award_evaluations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      precise_general_average NUMERIC NOT NULL,
      displayed_general_average NUMERIC NOT NULL,
      award_category TEXT NOT NULL CHECK (award_category IN ('With Highest Honors', 'With High Honors', 'With Honors', 'Academic Excellence Award', 'None')),
      presentation_order TEXT NOT NULL DEFAULT 'alphabetical',
      is_eligible BOOLEAN NOT NULL DEFAULT true
    );
  `);

  // Insert student and document
  const student = await db.query(`INSERT INTO public.students (lrn, full_name) VALUES ('123', 'Juan Dela Cruz') RETURNING id`);
  const studentId = student.rows[0].id;

  // Insert subject grade with exact decimal 74.5
  await db.query(`
    INSERT INTO public.subject_grades (
      student_id, school_year, semester, subject, q1, q2, final_grade, precise_computed_grade, displayed_final_grade
    ) VALUES ($1, '2024-2025', '1st Semester', 'Oral Comm', 75, 74, 74.5, 74.5, 75)
  `, [studentId]);

  // Insert award evaluation with Academic Excellence Award (proving DO 015 support and alphabetical order)
  await db.query(`
    INSERT INTO public.academic_award_evaluations (
      student_id, school_year, grade_level, precise_general_average, displayed_general_average, award_category, presentation_order
    ) VALUES ($1, '2026-2027', 'Grade 11', 92.4845, 92, 'Academic Excellence Award', 'alphabetical')
  `, [studentId]);

  // Retrieve and verify decimal precision preserved in NUMERIC
  const retrievedGrade = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1`, [studentId]);
  assert.strictEqual(Number(retrievedGrade.rows[0].final_grade), 74.5, "final_grade must preserve 74.5");
  assert.strictEqual(Number(retrievedGrade.rows[0].precise_computed_grade), 74.5);
  assert.strictEqual(Number(retrievedGrade.rows[0].displayed_final_grade), 75);

  const retrievedAward = await db.query(`SELECT * FROM public.academic_award_evaluations WHERE student_id = $1`, [studentId]);
  assert.strictEqual(Number(retrievedAward.rows[0].precise_general_average), 92.4845, "Award precise average must retain full precision");
  assert.strictEqual(retrievedAward.rows[0].award_category, 'Academic Excellence Award');
  assert.strictEqual(retrievedAward.rows[0].presentation_order, 'alphabetical');
});

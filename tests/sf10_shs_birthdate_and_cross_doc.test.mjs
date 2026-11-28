import test from "node:test";
import assert from "node:assert/strict";

import {
  monthToNumber,
  monthToFullName,
  monthToAbbreviation,
  monthToPaddedNumber,
  normalizeBirthDate,
  toIsoBirthDate,
  formatBirthDateDisplay,
  compareBirthDates,
  shuffleBirthDate,
  formatBirthDateWithDocLabel,
  MONTH_FULL_NAMES,
  MONTH_ABBREVIATIONS,
} from "../src/lib/validation/birthDateNormalizer.ts";

import {
  parseSf10ShsText,
  sf10RecordsToGradeRows,
  isSf10SectionHeader,
  stripTrailingRowLabels,
} from "../src/lib/ocr/sf10ShsParser.ts";
import { parseAzureLayoutGrades, extractTwoQuarterGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { calculateOcrMetrics } from "../src/lib/ocr/mistral.ts";
import { evaluateDynamicGradeStatus, normalizeStrictSex, roundSf10GeneralAverage } from "../src/lib/validation/gradeUtils.ts";
import { parsePsaBirthCert, extractPsaSexFromMarkPlacement } from "../src/lib/ocr/psaParser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";

import {
  compareSf10AndSf1,
  compareSf10AndSf9,
  compareSf10AndPsa,
  resolveSf10SemesterBlocks,
  evaluateUnifiedStudentValidation,
  evaluate4StateRowStatus,
  normalizeGradeLevelForComparison,
  reconcileStudentDataFromPrimarySources,
  reconcileStudentDataFromPrimaryKeys,
} from "../src/lib/validation/crossDocumentEngine.ts";
import { safeJsonStringify } from "../src/lib/upload/safeParseResponse.ts";
import { evaluateBatchCrossDocumentValidation } from "../src/lib/validation/batchCrossDocumentValidator.ts";

test("Universal Birthdate Normalizer, SF10-SHS Parser & Cross-Document Suite", async (t) => {
  // ---------------------------------------------------------------------------
  // 1. Universal Birthdate Month Normalization
  // ---------------------------------------------------------------------------
  await t.test("1a. Bidirectional month mapping: 01..12 and 1..9 <-> January..December & Jan..Dec", () => {
    // 01..12 to Full Name
    assert.equal(monthToFullName("01"), "January");
    assert.equal(monthToFullName("06"), "June");
    assert.equal(monthToFullName("07"), "July");
    assert.equal(monthToFullName("12"), "December");

    // 1..9 (single digits)
    assert.equal(monthToFullName(6), "June");
    assert.equal(monthToFullName("7"), "July");
    assert.equal(monthToFullName(1), "January");

    // Full names to padded numbers
    assert.equal(monthToPaddedNumber("January"), "01");
    assert.equal(monthToPaddedNumber("June"), "06");
    assert.equal(monthToPaddedNumber("July"), "07");
    assert.equal(monthToPaddedNumber("December"), "12");

    // Abbreviations
    assert.equal(monthToAbbreviation("06"), "Jun");
    assert.equal(monthToAbbreviation("June"), "Jun");
    assert.equal(monthToFullName("Jun"), "June");
    assert.equal(monthToNumber("JUN"), 6);
    assert.equal(monthToNumber("JUL"), 7);

    // All 12 months verified in order
    for (let i = 1; i <= 12; i++) {
      const pad = String(i).padStart(2, "0");
      const full = MONTH_FULL_NAMES[i - 1];
      const abbr = MONTH_ABBREVIATIONS[i - 1];
      assert.equal(monthToNumber(pad), i, `Number for ${pad}`);
      assert.equal(monthToFullName(pad), full, `Full name for ${pad}`);
      assert.equal(monthToAbbreviation(pad), abbr, `Abbreviation for ${pad}`);
      assert.equal(monthToPaddedNumber(full), pad, `Padded number for ${full}`);
    }
  });

  await t.test("1b. Date Normalization: SF10 (06/23/2004), SF1 (6/23/04), PSA (June 23, 2004) -> 2004-06-23", () => {
    const expectedIso = "2004-06-23";
    const expectedDisplay = "06/23/2004 (June 23, 2004)";

    // SF10 MM/DD/YYYY format
    const sf10Date = normalizeBirthDate("06/23/2004");
    assert.ok(sf10Date, "SF10 date must normalize");
    assert.equal(sf10Date.iso, expectedIso);
    assert.equal(sf10Date.display, expectedDisplay);

    // SF1 M/D/YY format
    const sf1Date = normalizeBirthDate("6/23/04");
    assert.ok(sf1Date, "SF1 date must normalize");
    assert.equal(sf1Date.iso, expectedIso);
    assert.equal(sf1Date.display, expectedDisplay);

    // PSA textual formats
    const psa1 = normalizeBirthDate("June 23, 2004");
    assert.ok(psa1);
    assert.equal(psa1.iso, expectedIso);
    assert.equal(psa1.display, expectedDisplay);

    const psa2 = normalizeBirthDate("23 June 2004");
    assert.ok(psa2);
    assert.equal(psa2.iso, expectedIso);

    const psa3 = normalizeBirthDate("JUN 23, 2004");
    assert.ok(psa3);
    assert.equal(psa3.iso, expectedIso);

    // Split Month / Day / Year fields
    const split = normalizeBirthDate({ month: "June", day: 23, year: 2004 });
    assert.ok(split);
    assert.equal(split.iso, expectedIso);
    assert.equal(split.display, expectedDisplay);

    // Labeled OCR string
    const labeled = normalizeBirthDate("Date of Birth (MM/DD/YYYY): 06/23/2004");
    assert.ok(labeled);
    assert.equal(labeled.iso, expectedIso);
  });

  await t.test("1c. Birthdate Comparison: Cross-format MATCH & MISMATCH detection", () => {
    // 06/23/2004 == June 23, 2004 == 6/23/04 -> MATCH
    const cmpPsa = compareBirthDates("06/23/2004", "June 23, 2004");
    assert.equal(cmpPsa.outcome, "MATCH");
    assert.ok(cmpPsa.note.includes("06/23/2004 (June 23, 2004)"));

    const cmpSf1 = compareBirthDates("06/23/2004", "6/23/04");
    assert.equal(cmpSf1.outcome, "MATCH");

    // 07/15/2004 == July 15, 2004 -> MATCH
    const cmpJuly = compareBirthDates("07/15/2004", "July 15, 2004");
    assert.equal(cmpJuly.outcome, "MATCH");
    assert.equal(cmpJuly.left?.iso, "2004-07-15");

    // Mismatch detection
    const cmpMismatch = compareBirthDates("06/23/2004", "06/24/2004");
    assert.equal(cmpMismatch.outcome, "MISMATCH");
    assert.ok(cmpMismatch.note.includes("mismatch"));
  });

  // ---------------------------------------------------------------------------
  // 2. SF10-SHS Dedicated Extraction
  // ---------------------------------------------------------------------------
  const sampleSf10Markdown = `
# SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)
## LEARNER'S INFORMATION
LAST NAME: GOMEZ   FIRST NAME: JUSTIN   MIDDLE NAME: LOQUILLANO
LRN: 111304501972   Date of Birth (MM/DD/YYYY): 06/23/2004   Sex: Male   Date of SHS Admission: 06/03/2019

## ELIGIBILITY FOR SHS ENROLMENT
High School Completer   Gen. Ave: 88   School Name: Taysan NHS   School ID: 301234

## SCHOLASTIC RECORD
| SCHOOL: Taysan Resettlement Integrated School | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 1st |
| TRACK/STRAND: Academic - STEM | SECTION: Rizal |
| Indicate if Subject is CORE, APPLIED, or SPECIALIZED | SUBJECTS | Quarter 1st | 2nd | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Oral Communication | 85 | 87 | 86 | PASSED |
| CORE | General Mathematics | 88 | 86 | 87 | PASSED |
| APPLIED | Empowerment Technologies | 86 | 88 | 87 | PASSED |
| SPECIALIZED | Pre-Calculus | 85 | 87 | 86 | PASSED |
| General Ave. for the Semester | | | | 86.5 | |

## SCHOLASTIC RECORD
| SCHOOL: Taysan Resettlement Integrated School | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 2nd |
| TRACK/STRAND: Academic - STEM | SECTION: Rizal |
| Indicate if Subject is CORE, APPLIED, or SPECIALIZED | SUBJECTS | Quarter 3rd | 4th | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Reading and Writing | 86 | 88 | 87 | PASSED |
| SPECIALIZED | Basic Calculus | 86 | 86 | 86 | PASSED |
| General Ave. for the Semester | | | | 86.8 | |
`;

  await t.test("2a. Extract Learner's Information strictly", () => {
    const result = parseSf10ShsText(sampleSf10Markdown);
    const { learner } = result;

    assert.equal(learner.last_name, "GOMEZ");
    assert.equal(learner.first_name, "JUSTIN");
    assert.equal(learner.middle_name, "LOQUILLANO");
    assert.equal(learner.full_name, "GOMEZ, JUSTIN LOQUILLANO");
    assert.equal(learner.lrn, "111304501972");
    assert.equal(learner.birth_date, "2004-06-23");
    assert.equal(learner.birth_date_display, "06/23/2004 (June 23, 2004)");
    assert.equal(learner.sex, "Male");
  });

  await t.test("2b. Section header rejection guard: LEARNER'S INFORMATION, SCHOLASTIC RECORD, ELIGIBILITY", () => {
    assert.equal(isSf10SectionHeader("LEARNER'S INFORMATION"), true);
    assert.equal(isSf10SectionHeader("LEARNERS INFORMATION"), true);
    assert.equal(isSf10SectionHeader("SCHOLASTIC RECORD"), true);
    assert.equal(isSf10SectionHeader("ELIGIBILITY FOR SHS ENROLMENT"), true);
    assert.equal(isSf10SectionHeader("GOMEZ, JUSTIN LOQUILLANO"), false);
    assert.equal(isSf10SectionHeader("Oral Communication"), false);
  });

  await t.test("2c. Scholastic Record headers and Sem 1 & Sem 2 subject extraction with General Averages (86.5 & 86.8)", () => {
    const result = parseSf10ShsText(sampleSf10Markdown);
    assert.equal(result.scholastic_records.length, 2, "Must extract 2 semester blocks");

    // Block 1 (Sem 1)
    const sem1 = result.scholastic_records[0];
    assert.equal(sem1.school_id, "500619", "School ID must be 500619 (not JHS 301234)");
    assert.equal(sem1.grade_level, "Grade 11");
    assert.equal(sem1.school_year, "2019-2020");
    assert.equal(sem1.semester, "1st Semester");
    assert.equal(sem1.track_strand, "Academic - STEM");
    assert.equal(sem1.section, "Rizal");
    assert.equal(sem1.general_average, 86.5, "Sem 1 General Ave must be 86.5");
    assert.equal(sem1.subjects.length, 4, "Sem 1 must have 4 subjects");

    const oralComm = sem1.subjects.find((s) => s.subject === "Oral Communication");
    assert.ok(oralComm);
    assert.equal(oralComm.subject_type, "CORE");
    assert.equal(oralComm.q1, 85);
    assert.equal(oralComm.q2, 87);
    assert.equal(oralComm.sem_final_grade, 86);
    assert.equal(oralComm.action_taken, "PASSED");

    // Block 2 (Sem 2)
    const sem2 = result.scholastic_records[1];
    assert.equal(sem2.school_id, "500619");
    assert.equal(sem2.grade_level, "Grade 11");
    assert.equal(sem2.school_year, "2019-2020");
    assert.equal(sem2.semester, "2nd Semester");
    assert.equal(sem2.track_strand, "Academic - STEM");
    assert.equal(sem2.section, "Rizal");
    assert.equal(sem2.general_average, 86.8, "Sem 2 General Ave must be 86.8");
    assert.equal(sem2.subjects.length, 2, "Sem 2 must have 2 subjects");

    const basicCalc = sem2.subjects.find((s) => s.subject === "Basic Calculus");
    assert.ok(basicCalc);
    assert.equal(basicCalc.subject_type, "SPECIALIZED");
    assert.equal(basicCalc.q3, 86);
    assert.equal(basicCalc.q4, 86);
    assert.equal(basicCalc.sem_final_grade, 86);
    assert.equal(basicCalc.action_taken, "PASSED");
  });

  await t.test("2d. SF10 Sem 2 strips trailing grade tokens, parses true Q3/Q4 pairs, exact categories & School Name", () => {
    const rawOcrSf10Text = `
REPUBLIC OF THE PHILIPPINES
DEPARTMENT OF EDUCATION
REGION III - CENTRAL LUZON
DIVISION OF TARLAC PROVINCE

SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)
LEARNER'S INFORMATION
LAST NAME: GOMEZ   FIRST NAME: JUSTIN   MIDDLE NAME: LOQUILLANO
LRN: 111304501972   Date of Birth: 06/23/2004   Sex: Male

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 1st |
TRACK/STRAND: Academic - STEM | SECTION: Rizal
| Indicate if Subject is CORE, APPLIED, or SPECIALIZED | SUBJECTS | Quarter 1st | 2nd | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Oral Communication | 85 | 87 | 86 | PASSED |
| APPLIED | Empowerment Technologies | 86 | 88 | 87 | PASSED |
| SPECIALIZED | Pre-Calculus | 80 | 82 | 81 | PASSED |
| SPECIALIZED | General Chemistry 1 | 82 | 84 | 83 | PASSED |
| General Ave. for the Semester | | | | 86.5 | |

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 2nd |
TRACK/STRAND: Academic - STEM | SECTION: Rizal
| Indicate if Subject is CORE, APPLIED, or SPECIALIZED | SUBJECTS | Quarter 3rd | 4th | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Reading and Writing | 70 | 98 | 84 | PASSED |
| CORE | Physical Education and Health 2 95 | 75 | 85 | PASSED |
| CORE | Statistics and Probability 86 | 87 | 87 | PASSED |
| CORE | Disaster Readiness and Risk Reduction 91 | 93 | 92 | PASSED |
| APPLIED | Practical Research 1 84 | 87 | 86 | PASSED |
| SPECIALIZED | Basic Calculus 88 | 98 | 93 | PASSED |
| SPECIALIZED | General Chemistry 2 78 | 81 | 80 | PASSED |
| General Ave. for the Semester | | | | 86.8 | |
`;

    const parsed = parseSf10ShsText(rawOcrSf10Text);
    assert.equal(parsed.scholastic_records.length, 2);

    // School Name verification: strictly TAYSAN RESETTLEMENT INTEGRATED SCHOOL, never DepEd banner
    assert.equal(parsed.scholastic_records[0].school_name, "TAYSAN RESETTLEMENT INTEGRATED SCHOOL");
    assert.equal(parsed.scholastic_records[1].school_name, "TAYSAN RESETTLEMENT INTEGRATED SCHOOL");

    const sem2 = parsed.scholastic_records[1];
    assert.equal(sem2.subjects.length, 7);

    // 1. Reading and Writing: 70 & 98 -> 84
    const rw = sem2.subjects.find((s) => s.subject === "Reading and Writing");
    assert.ok(rw);
    assert.equal(rw.subject_type, "CORE");
    assert.equal(rw.q3, 70);
    assert.equal(rw.q4, 98);
    assert.equal(rw.sem_final_grade, 84);

    // 2. Physical Education and Health 2: stripped trailing 95 -> Q3 = 95, Q4 = 75, Final = 85
    const pe = sem2.subjects.find((s) => s.subject === "Physical Education and Health 2");
    assert.ok(pe, "Physical Education and Health 2 must not retain trailing 95 in title");
    assert.equal(pe.subject_type, "CORE");
    assert.equal(pe.q3, 95);
    assert.equal(pe.q4, 75);
    assert.equal(pe.sem_final_grade, 85);

    // 3. Statistics and Probability: stripped trailing 86 -> Q3 = 86, Q4 = 87, Final = 87
    const stat = sem2.subjects.find((s) => s.subject === "Statistics and Probability");
    assert.ok(stat, "Statistics and Probability must not retain trailing 86 in title");
    assert.equal(stat.subject_type, "CORE");
    assert.equal(stat.q3, 86);
    assert.equal(stat.q4, 87);
    assert.equal(stat.sem_final_grade, 87);

    // 4. Disaster Readiness and Risk Reduction: stripped trailing 91 -> Q3 = 91, Q4 = 93, Final = 92
    const drrr = sem2.subjects.find((s) => s.subject === "Disaster Readiness and Risk Reduction");
    assert.ok(drrr, "Disaster Readiness and Risk Reduction must not retain trailing 91 in title");
    assert.equal(drrr.subject_type, "CORE");
    assert.equal(drrr.q3, 91);
    assert.equal(drrr.q4, 93);
    assert.equal(drrr.sem_final_grade, 92);

    // 5. Practical Research 1: stripped trailing 84 -> Q3 = 84, Q4 = 87, Final = 86, Category = APPLIED
    const pr1 = sem2.subjects.find((s) => s.subject === "Practical Research 1");
    assert.ok(pr1, "Practical Research 1 must not retain trailing 84 in title");
    assert.equal(pr1.subject_type, "APPLIED");
    assert.equal(pr1.q3, 84);
    assert.equal(pr1.q4, 87);
    assert.equal(pr1.sem_final_grade, 86);

    // 6. Basic Calculus: stripped trailing 88 -> Q3 = 88, Q4 = 98, Final = 93, Category = SPECIALIZED
    const bc = sem2.subjects.find((s) => s.subject === "Basic Calculus");
    assert.ok(bc, "Basic Calculus must not retain trailing 88 in title");
    assert.equal(bc.subject_type, "SPECIALIZED");
    assert.equal(bc.q3, 88);
    assert.equal(bc.q4, 98);
    assert.equal(bc.sem_final_grade, 93);

    // 7. General Chemistry 2: stripped trailing 78 -> Q3 = 78, Q4 = 81, Final = 80, Category = SPECIALIZED
    const gc2 = sem2.subjects.find((s) => s.subject === "General Chemistry 2");
    assert.ok(gc2, "General Chemistry 2 must not retain trailing 78 in title");
    assert.equal(gc2.subject_type, "SPECIALIZED");
    assert.equal(gc2.q3, 78);
    assert.equal(gc2.q4, 81);
    assert.equal(gc2.sem_final_grade, 80);
  });

  await t.test("2e. SF10 Learner Name strips trailing row labels & rejects eligibility strings for school name", () => {
    // 1. Strip trailing row labels from learner name line
    const nameWithTrailing = "GOMEZ, JUSTIN LOQUILLANO Date of SHS Admission (MM/DD/YYYY): 06/05/2023";
    const cleanedName = stripTrailingRowLabels(nameWithTrailing);
    assert.equal(cleanedName, "GOMEZ, JUSTIN LOQUILLANO");

    const sampleDoc = `
SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)
LEARNER'S INFORMATION
NAME: GOMEZ, JUSTIN LOQUILLANO Date of SHS Admission (MM/DD/YYYY): 06/05/2023
LRN: 111304501972   Date of Birth: 06/23/2004   Sex: Male

ELIGIBILITY FOR SHS ENROLMENT
Junior High School Completer* Gen. Ave: 88 School Name: Capas High School

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 1st |
TRACK/STRAND: Academic - STEM | SECTION: Rizal
| Indicate if Subject is CORE, APPLIED, or SPECIALIZED | SUBJECTS | Quarter 1st | 2nd | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Oral Communication | 76 | 94 | 85 | PASSED |
| CORE | General Mathematics | 89 | 83 | 86 | PASSED |
| CORE | Earth and Life Science | 91 | 92 | 92 | PASSED |
| CORE | 21st Century Literature | 96 | 79 | 88 | PASSED |
| CORE | Komunikasyon at Pananaliksik | 90 | 80 | 85 | PASSED |
| General Ave. for the Semester | | | | 86.5 | |

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 2nd |
TRACK/STRAND: Academic - STEM | SECTION: Rizal
| Indicate if Subject is CORE, APPLIED, or SPECIALIZED | SUBJECTS | Quarter 3rd | 4th | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Reading and Writing | 70 | 98 | 84 | PASSED |
| CORE | Pagbasa at Pagsusuri | 80 | 80 | 80 | PASSED |
| CORE | Personal Development | 90 | 90 | 90 | PASSED |
| CORE | Physical Education and Health 2 95 | 75 | 85 | PASSED |
| CORE | Statistics and Probability 86 | 87 | 87 | PASSED |
| CORE | Disaster Readiness and Risk Reduction 91 | 93 | 92 | PASSED |
| APPLIED | Practical Research 1 84 | 87 | 86 | PASSED |
| SPECIALIZED | Basic Calculus 88 | 98 | 93 | PASSED |
| SPECIALIZED | General Chemistry 2 78 | 81 | 80 | PASSED |
| General Ave. for the Semester | | | | | |
`;

    const parsed = parseSf10ShsText(sampleDoc);
    assert.equal(parsed.learner.full_name, "GOMEZ, JUSTIN LOQUILLANO");
    assert.equal(parsed.learner.last_name, "GOMEZ");
    assert.equal(parsed.learner.first_name, "JUSTIN");
    assert.equal(parsed.learner.middle_name, "LOQUILLANO");

    // School name must be strictly TAYSAN RESETTLEMENT INTEGRATED SCHOOL and never eligibility string
    assert.equal(parsed.scholastic_records[0].school_name, "TAYSAN RESETTLEMENT INTEGRATED SCHOOL");
    assert.equal(parsed.scholastic_records[1].school_name, "TAYSAN RESETTLEMENT INTEGRATED SCHOOL");

    // Sem 1 General Average extracted as 86.5
    assert.equal(parsed.scholastic_records[0].general_average, 86.5);

    // Sem 2 General Average is blank -> must be undefined
    assert.equal(parsed.scholastic_records[1].general_average, undefined);

    // Distinct quarter values across Sem 1 pairs (76/94, 89/83, 91/92, 96/79, 90/80)
    const sem1 = parsed.scholastic_records[0];
    const oc = sem1.subjects.find((s) => s.subject === "Oral Communication");
    assert.equal(oc?.q1, 76);
    assert.equal(oc?.q2, 94);

    const gm = sem1.subjects.find((s) => s.subject === "General Mathematics");
    assert.equal(gm?.q1, 89);
    assert.equal(gm?.q2, 83);

    // Distinct quarter values across Sem 2 pairs
    const sem2 = parsed.scholastic_records[1];
    assert.equal(sem2.subjects.length, 9);
    const rw = sem2.subjects.find((s) => s.subject === "Reading and Writing");
    assert.equal(rw?.q3, 70);
    assert.equal(rw?.q4, 98);

    const pe = sem2.subjects.find((s) => s.subject === "Physical Education and Health 2");
    assert.equal(pe?.q3, 95);
    assert.equal(pe?.q4, 75);

    const pr1 = sem2.subjects.find((s) => s.subject === "Practical Research 1");
    assert.equal(pr1?.q3, 84);
    assert.equal(pr1?.q4, 87);

    const bc = sem2.subjects.find((s) => s.subject === "Basic Calculus");
    assert.equal(bc?.q3, 88);
    assert.equal(bc?.q4, 98);

    const gc2 = sem2.subjects.find((s) => s.subject === "General Chemistry 2");
    assert.equal(gc2?.q3, 78);
    assert.equal(gc2?.q4, 81);
  });

  await t.test("2f. SF10-SHS Single-Page 4-Table Layout: Sem 1 (6-col), Remedial Ignored, Sem 2 (5-col merged quarter), Remedial Ignored & Decimal General Averages (86.5 & 86.8)", () => {
    // 1. Test via Markdown & Reconstructed Rows in parseSf10ShsText
    const singlePageSf10Text = `
SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)
LEARNER'S INFORMATION
LAST NAME: GOMEZ   FIRST NAME: JUSTIN   MIDDLE NAME: LOQUILLANO
LRN: 111304501972   Date of Birth: 06/23/2004   Sex: Male

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 1 | SECTION: Rizal
| Category | SUBJECTS | Quarter 1ST | 2ND | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Oral Communication | 85 | 87 | 86 | PASSED |
| CORE | Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino | 86 | 84 | 85 | PASSED |
| CORE | General Mathematics | 88 | 86 | 87 | PASSED |
| CORE | Earth and Life Science | 89 | 87 | 88 | PASSED |
| CORE | Personal Development | 90 | 92 | 91 | PASSED |
| CORE | Understanding Culture, Society and Politics | 84 | 86 | 85 | PASSED |
| CORE | Physical Education and Health 1 | 87 | 89 | 88 | PASSED |
| APPLIED | Empowerment Technologies | 86 | 88 | 87 | PASSED |
| SPECIALIZED | Pre-Calculus | 85 | 87 | 86 | PASSED |
| General Ave. for the Semester | | | | 86.5 | |

REMEDIAL CLASSES
| REMEDIAL CLASS MARK | RECOMPUTED FINAL GRADE | ACTION TAKEN |
|---|---|---|

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 2 | SECTION: Rizal
| Category | SUBJECTS | Quarter 4TH 3RD | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|
| CORE | Reading and Writing | 70 98 | 84 | PASSED |
| CORE | Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik | 85 85 | 85 | PASSED |
| CORE | Statistics and Probability | 86 87 | 87 | PASSED |
| CORE | Physical Education and Health 3 | 75 95 | 85 | PASSED |
| CORE | Disaster Readiness and Risk Reduction | 91 93 | 92 | PASSED |
| CORE | Filipino sa Piling Larangan | 88 88 | 88 | PASSED |
| APPLIED | Practical Research 1 | 84 87 | 86 | PASSED |
| SPECIALIZED | Basic Calculus | 88 98 | 93 | PASSED |
| SPECIALIZED | General Chemistry 2 | 78 81 | 80 | PASSED |
| General Ave. for the Semester | | | 86.8 | |

REMEDIAL CLASSES
| REMEDIAL CLASS MARK | RECOMPUTED FINAL GRADE | ACTION TAKEN |
|---|---|---|
`;

    const parsedSf10 = parseSf10ShsText(singlePageSf10Text);
    assert.equal(parsedSf10.scholastic_records.length, 2, "Must extract exactly 2 scholastic record semesters, ignoring remedial classes");

    // Sem 1 verification
    const s1 = parsedSf10.scholastic_records[0];
    assert.equal(s1.semester, "1st Semester");
    assert.equal(s1.general_average, 86.5);
    assert.equal(s1.subjects.length, 9, "Sem 1 must have all 9 subjects");
    const oc = s1.subjects.find((s) => s.subject === "Oral Communication");
    assert.equal(oc?.q1, 85);
    assert.equal(oc?.q2, 87);
    assert.equal(oc?.sem_final_grade, 86);
    assert.equal(oc?.action_taken, "PASSED");

    // Sem 2 verification with merged quarter splitting (4TH before 3RD)
    const s2 = parsedSf10.scholastic_records[1];
    assert.equal(s2.semester, "2nd Semester");
    assert.equal(s2.general_average, 86.8);
    assert.equal(s2.subjects.length, 9, "Sem 2 must have all 9 subjects");

    const rw = s2.subjects.find((s) => s.subject === "Reading and Writing");
    assert.ok(rw);
    assert.equal(rw.q4, 70, "Q4 must be 70 (first number in Quarter 4TH 3RD)");
    assert.equal(rw.q3, 98, "Q3 must be 98 (second number in Quarter 4TH 3RD)");
    assert.equal(rw.sem_final_grade, 84);
    assert.equal(rw.action_taken, "PASSED");

    const pe3 = s2.subjects.find((s) => s.subject === "Physical Education and Health 3");
    assert.ok(pe3);
    assert.equal(pe3.q4, 75);
    assert.equal(pe3.q3, 95);
    assert.equal(pe3.sem_final_grade, 85, "PE Sem Final Grade must be strictly 85, never overwritten by quarter cell");
    assert.equal(pe3.action_taken, "PASSED");

    // 2. Test via Azure Layout Tables in parseAzureLayoutGrades
    const mockAzureTables = [
      // Table 1: Sem 1 (6 columns)
      {
        rowCount: 11,
        columnCount: 6,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "Category" },
          { rowIndex: 0, columnIndex: 1, content: "SUBJECTS" },
          { rowIndex: 0, columnIndex: 2, content: "Quarter 1ST" },
          { rowIndex: 0, columnIndex: 3, content: "2ND" },
          { rowIndex: 0, columnIndex: 4, content: "SEM FINAL GRADE" },
          { rowIndex: 0, columnIndex: 5, content: "ACTION TAKEN" },
          // Subject 1
          { rowIndex: 1, columnIndex: 0, content: "CORE" },
          { rowIndex: 1, columnIndex: 1, content: "Oral Communication" },
          { rowIndex: 1, columnIndex: 2, content: "85" },
          { rowIndex: 1, columnIndex: 3, content: "87" },
          { rowIndex: 1, columnIndex: 4, content: "86" },
          { rowIndex: 1, columnIndex: 5, content: "PASSED" },
          // Subject 2
          { rowIndex: 2, columnIndex: 0, content: "CORE" },
          { rowIndex: 2, columnIndex: 1, content: "General Mathematics" },
          { rowIndex: 2, columnIndex: 2, content: "88" },
          { rowIndex: 2, columnIndex: 3, content: "86" },
          { rowIndex: 2, columnIndex: 4, content: "87" },
          { rowIndex: 2, columnIndex: 5, content: "PASSED" },
          // General Ave Row
          { rowIndex: 3, columnIndex: 0, content: "General Ave. for the Semester" },
          { rowIndex: 3, columnIndex: 1, content: "" },
          { rowIndex: 3, columnIndex: 2, content: "" },
          { rowIndex: 3, columnIndex: 3, content: "" },
          { rowIndex: 3, columnIndex: 4, content: "86.5" },
          { rowIndex: 3, columnIndex: 5, content: "" },
        ],
      },
      // Table 2: Sem 1 Remedial Classes (ignored)
      {
        rowCount: 3,
        columnCount: 6,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "REMEDIAL CLASSES" },
          { rowIndex: 0, columnIndex: 1, content: "REMEDIAL CLASS MARK" },
          { rowIndex: 0, columnIndex: 2, content: "RECOMPUTED FINAL GRADE" },
        ],
      },
      // Table 3: Sem 2 (5 columns with merged quarter in col 2)
      {
        rowCount: 11,
        columnCount: 5,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "Category" },
          { rowIndex: 0, columnIndex: 1, content: "SUBJECTS" },
          { rowIndex: 0, columnIndex: 2, content: "Quarter 4TH 3RD" },
          { rowIndex: 0, columnIndex: 3, content: "SEM FINAL GRADE" },
          { rowIndex: 0, columnIndex: 4, content: "ACTION TAKEN" },
          // Subject 1
          { rowIndex: 1, columnIndex: 0, content: "CORE" },
          { rowIndex: 1, columnIndex: 1, content: "Reading and Writing" },
          { rowIndex: 1, columnIndex: 2, content: "70\n98" },
          { rowIndex: 1, columnIndex: 3, content: "84" },
          { rowIndex: 1, columnIndex: 4, content: "PASSED" },
          // Subject 2
          { rowIndex: 2, columnIndex: 0, content: "CORE" },
          { rowIndex: 2, columnIndex: 1, content: "Physical Education and Health 3" },
          { rowIndex: 2, columnIndex: 2, content: "75\n95" },
          { rowIndex: 2, columnIndex: 3, content: "85" },
          { rowIndex: 2, columnIndex: 4, content: "PASSED" },
          // General Ave Row
          { rowIndex: 3, columnIndex: 0, content: "General Ave. for the Semester" },
          { rowIndex: 3, columnIndex: 1, content: "" },
          { rowIndex: 3, columnIndex: 2, content: "" },
          { rowIndex: 3, columnIndex: 3, content: "86.8" },
          { rowIndex: 3, columnIndex: 4, content: "" },
        ],
      },
      // Table 4: Sem 2 Remedial Classes (ignored)
      {
        rowCount: 3,
        columnCount: 6,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "REMEDIAL CLASSES" },
          { rowIndex: 0, columnIndex: 1, content: "REMEDIAL CLASS MARK" },
          { rowIndex: 0, columnIndex: 2, content: "RECOMPUTED FINAL GRADE" },
        ],
      },
    ];

    const azureResult = parseAzureLayoutGrades(mockAzureTables);
    assert.equal(azureResult.sem1_general_average, 86.5, "Azure Sem 1 General Average must be 86.5");
    assert.equal(azureResult.sem2_general_average, 86.8, "Azure Sem 2 General Average must be 86.8");

    const azureSem1 = azureResult.grades.filter((g) => g.semester === "1st Semester");
    const azureSem2 = azureResult.grades.filter((g) => g.semester === "2nd Semester");
    assert.ok(azureSem1.length >= 2, "Must extract Sem 1 grades");
    assert.ok(azureSem2.length >= 2, "Must extract Sem 2 grades");

    const azRw = azureSem2.find((g) => g.subject === "Reading and Writing");
    assert.ok(azRw);
    assert.equal(azRw.q4, 70);
    assert.equal(azRw.q3, 98);
    assert.equal(azRw.final, 84);

    const azPe = azureSem2.find((g) => g.subject === "Physical Education and Health 3");
    assert.ok(azPe);
    assert.equal(azPe.q4, 75);
    assert.equal(azPe.q3, 95);
    assert.equal(azPe.final, 85);

    // 3. Dynamic evaluation of decimal General Averages: 86.5 & 86.8 -> PASSED
    const evalSem1 = evaluateDynamicGradeStatus({ grade: 86.5, allowDecimal: true, isGeneralAverage: true });
    assert.equal(evalSem1.status, "passed");
    assert.equal(evalSem1.remarkDisplay, "PASSED");
    assert.equal(evalSem1.gradeDisplay, "86.5");

    const evalSem2 = evaluateDynamicGradeStatus({ grade: 86.8, allowDecimal: true, isGeneralAverage: true });
    assert.equal(evalSem2.status, "passed");
    assert.equal(evalSem2.remarkDisplay, "PASSED");
    assert.equal(evalSem2.gradeDisplay, "86.8");

    // 4. Test via full parseGradesText (docType = "sf10")
    const fullSf10 = parseGradesText(singlePageSf10Text, "Senior High School", undefined, "sf10");
    assert.equal(fullSf10.document_type, "sf10");
    assert.equal(fullSf10.sem1_general_average, 86.5);
    assert.equal(fullSf10.sem1_printed_general_average, 86.5);
    assert.equal(fullSf10.sem2_general_average, 86.8);
    assert.equal(fullSf10.sem2_printed_general_average, 86.8);
    assert.equal(fullSf10.sem1_confidence, 95);
    assert.equal(fullSf10.sem2_confidence, 95);
    assert.ok(Array.isArray(fullSf10.shs_semesters) && fullSf10.shs_semesters.length === 2);
    assert.ok(Array.isArray(fullSf10.grades) && fullSf10.grades.length === 18);
  });

  await t.test("2f-2. SF10-SHS Exact 18 Subjects (9 Sem 1 & 9 Sem 2 with trailing-quarter splitting for PE 2 95 through Gen Chem 2 78) mapped for /upload and /api/scan/batch", () => {
    const rawOcrSf10All18Text = `
SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)
LEARNER'S INFORMATION
LAST NAME: GOMEZ   FIRST NAME: JUSTIN   MIDDLE NAME: LOQUILLANO
LRN: 111304501972   Date of Birth: 06/23/2004   Sex: Male

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 1st | SECTION: Rizal
| Category | SUBJECTS | Quarter 1st | 2nd | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Oral Communication | 85 | 87 | 86 | PASSED |
| CORE | Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino | 86 | 84 | 85 | PASSED |
| CORE | General Mathematics | 88 | 86 | 87 | PASSED |
| CORE | Earth and Life Science | 89 | 87 | 88 | PASSED |
| CORE | Personal Development | 90 | 92 | 91 | PASSED |
| CORE | Understanding Culture, Society and Politics | 84 | 86 | 85 | PASSED |
| CORE | Physical Education and Health 1 | 87 | 89 | 88 | PASSED |
| APPLIED | Empowerment Technologies | 86 | 88 | 87 | PASSED |
| SPECIALIZED | Pre-Calculus | 85 | 87 | 86 | PASSED |
| General Ave. for the Semester | | | | 86.5 | |

SCHOLASTIC RECORD
SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL | SCHOOL ID: 500619 | GRADE LEVEL: 11 | SY: 2019-2020 | SEM: 2nd | SECTION: Rizal
| Category | SUBJECTS | Quarter 3rd | 4th | SEM FINAL GRADE | ACTION TAKEN |
|---|---|---|---|---|---|
| CORE | Reading and Writing | 70 | 98 | 84 | PASSED |
| CORE | Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik | 80 | 80 | 80 | PASSED |
| CORE | Personal Development (Pansariling Kaunlaran) | 90 | 90 | 90 | PASSED |
| CORE | Physical Education and Health 2 95 | 75 | 85 | PASSED |
| CORE | Statistics and Probability 86 | 87 | 87 | PASSED |
| CORE | Disaster Readiness and Risk Reduction 91 | 93 | 92 | PASSED |
| APPLIED | Practical Research 1 84 | 87 | 86 | PASSED |
| SPECIALIZED | Basic Calculus 88 | 98 | 93 | PASSED |
| SPECIALIZED | General Chemistry 2 78 | 81 | 80 | PASSED |
| General Ave. for the Semester | | | | 86.8 | |
`;

    // 1. Parse via parseSf10ShsText
    const parsed = parseSf10ShsText(rawOcrSf10All18Text);
    assert.equal(parsed.scholastic_records.length, 2);

    const sem1 = parsed.scholastic_records[0];
    const sem2 = parsed.scholastic_records[1];

    assert.equal(sem1.subjects.length, 9, "Sem 1 must have exactly 9 subjects");
    assert.equal(sem2.subjects.length, 9, "Sem 2 must have exactly 9 subjects");
    assert.equal(sem1.general_average, 86.5);
    assert.equal(sem2.general_average, 86.8);

    // Verify Sem 2 exact values
    const s2Subs = sem2.subjects;
    // Row 1
    assert.equal(s2Subs[0].subject, "Reading and Writing");
    assert.equal(s2Subs[0].q3, 70);
    assert.equal(s2Subs[0].q4, 98);
    assert.equal(s2Subs[0].sem_final_grade, 84);
    assert.equal(s2Subs[0].action_taken, "PASSED");

    // Row 2
    assert.equal(s2Subs[1].subject, "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik");
    assert.equal(s2Subs[1].q3, 80);
    assert.equal(s2Subs[1].q4, 80);
    assert.equal(s2Subs[1].sem_final_grade, 80);
    assert.equal(s2Subs[1].action_taken, "PASSED");

    // Row 3
    assert.equal(s2Subs[2].subject, "Personal Development (Pansariling Kaunlaran)");
    assert.equal(s2Subs[2].q3, 90);
    assert.equal(s2Subs[2].q4, 90);
    assert.equal(s2Subs[2].sem_final_grade, 90);
    assert.equal(s2Subs[2].action_taken, "PASSED");

    // Row 4: Physical Education and Health 2 (95 stripped -> Q3=95, Q4=75, Final=85)
    assert.equal(s2Subs[3].subject, "Physical Education and Health 2");
    assert.equal(s2Subs[3].q3, 95);
    assert.equal(s2Subs[3].q4, 75);
    assert.equal(s2Subs[3].sem_final_grade, 85);
    assert.equal(s2Subs[3].action_taken, "PASSED");

    // Row 5: Statistics and Probability (86 stripped -> Q3=86, Q4=87, Final=87)
    assert.equal(s2Subs[4].subject, "Statistics and Probability");
    assert.equal(s2Subs[4].q3, 86);
    assert.equal(s2Subs[4].q4, 87);
    assert.equal(s2Subs[4].sem_final_grade, 87);
    assert.equal(s2Subs[4].action_taken, "PASSED");

    // Row 6: Disaster Readiness and Risk Reduction (91 stripped -> Q3=91, Q4=93, Final=92)
    assert.equal(s2Subs[5].subject, "Disaster Readiness and Risk Reduction");
    assert.equal(s2Subs[5].q3, 91);
    assert.equal(s2Subs[5].q4, 93);
    assert.equal(s2Subs[5].sem_final_grade, 92);
    assert.equal(s2Subs[5].action_taken, "PASSED");

    // Row 7: Practical Research 1 (84 stripped -> Q3=84, Q4=87, Final=86)
    assert.equal(s2Subs[6].subject, "Practical Research 1");
    assert.equal(s2Subs[6].q3, 84);
    assert.equal(s2Subs[6].q4, 87);
    assert.equal(s2Subs[6].sem_final_grade, 86);
    assert.equal(s2Subs[6].action_taken, "PASSED");

    // Row 8: Basic Calculus (88 stripped -> Q3=88, Q4=98, Final=93)
    assert.equal(s2Subs[7].subject, "Basic Calculus");
    assert.equal(s2Subs[7].q3, 88);
    assert.equal(s2Subs[7].q4, 98);
    assert.equal(s2Subs[7].sem_final_grade, 93);
    assert.equal(s2Subs[7].action_taken, "PASSED");

    // Row 9: General Chemistry 2 (78 stripped -> Q3=78, Q4=81, Final=80)
    assert.equal(s2Subs[8].subject, "General Chemistry 2");
    assert.equal(s2Subs[8].q3, 78);
    assert.equal(s2Subs[8].q4, 81);
    assert.equal(s2Subs[8].sem_final_grade, 80);
    assert.equal(s2Subs[8].action_taken, "PASSED");

    // Exact Sem 2 final grades sequence
    const actualSem2Finals = s2Subs.map((s) => s.sem_final_grade);
    assert.deepEqual(actualSem2Finals, [84, 80, 90, 85, 87, 92, 86, 93, 80]);

    // 2. Parse via parseGradesText (docType = "sf10")
    const gradesRes = parseGradesText(rawOcrSf10All18Text, "Senior High School", undefined, "sf10");
    assert.equal(gradesRes.grades?.length, 18);
    assert.equal(gradesRes.first_semester_grades?.length, 9);
    assert.equal(gradesRes.second_semester_grades?.length, 9);
    assert.equal(gradesRes.sem1_general_average, 86.5);
    assert.equal(gradesRes.sem2_general_average, 86.8);

    // 3. Test Azure Layout table representation for Sem 2
    const azureSem2Table = {
      rowCount: 11,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Category" },
        { rowIndex: 0, columnIndex: 1, content: "SUBJECTS" },
        { rowIndex: 0, columnIndex: 2, content: "Quarter 3rd" },
        { rowIndex: 0, columnIndex: 3, content: "4th" },
        { rowIndex: 0, columnIndex: 4, content: "SEM FINAL GRADE" },
        { rowIndex: 0, columnIndex: 5, content: "ACTION TAKEN" },

        // Rows 1-3 separate cells
        { rowIndex: 1, columnIndex: 0, content: "CORE" },
        { rowIndex: 1, columnIndex: 1, content: "Reading and Writing" },
        { rowIndex: 1, columnIndex: 2, content: "70" },
        { rowIndex: 1, columnIndex: 3, content: "98" },
        { rowIndex: 1, columnIndex: 4, content: "84" },
        { rowIndex: 1, columnIndex: 5, content: "PASSED" },

        { rowIndex: 2, columnIndex: 0, content: "CORE" },
        { rowIndex: 2, columnIndex: 1, content: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik" },
        { rowIndex: 2, columnIndex: 2, content: "80" },
        { rowIndex: 2, columnIndex: 3, content: "80" },
        { rowIndex: 2, columnIndex: 4, content: "80" },
        { rowIndex: 2, columnIndex: 5, content: "PASSED" },

        { rowIndex: 3, columnIndex: 0, content: "CORE" },
        { rowIndex: 3, columnIndex: 1, content: "Personal Development (Pansariling Kaunlaran)" },
        { rowIndex: 3, columnIndex: 2, content: "90" },
        { rowIndex: 3, columnIndex: 3, content: "90" },
        { rowIndex: 3, columnIndex: 4, content: "90" },
        { rowIndex: 3, columnIndex: 5, content: "PASSED" },

        // Rows 4-9 trailing 3rd quarter grade appended to subject cell
        { rowIndex: 4, columnIndex: 0, content: "CORE" },
        { rowIndex: 4, columnIndex: 1, content: "Physical Education and Health 2 95" },
        { rowIndex: 4, columnIndex: 2, content: "75" },
        { rowIndex: 4, columnIndex: 3, content: "85" },
        { rowIndex: 4, columnIndex: 4, content: "PASSED" },

        { rowIndex: 5, columnIndex: 0, content: "CORE" },
        { rowIndex: 5, columnIndex: 1, content: "Statistics and Probability 86" },
        { rowIndex: 5, columnIndex: 2, content: "87" },
        { rowIndex: 5, columnIndex: 3, content: "87" },
        { rowIndex: 5, columnIndex: 4, content: "PASSED" },

        { rowIndex: 6, columnIndex: 0, content: "CORE" },
        { rowIndex: 6, columnIndex: 1, content: "Disaster Readiness and Risk Reduction 91" },
        { rowIndex: 6, columnIndex: 2, content: "93" },
        { rowIndex: 6, columnIndex: 3, content: "92" },
        { rowIndex: 6, columnIndex: 4, content: "PASSED" },

        { rowIndex: 7, columnIndex: 0, content: "APPLIED" },
        { rowIndex: 7, columnIndex: 1, content: "Practical Research 1 84" },
        { rowIndex: 7, columnIndex: 2, content: "87" },
        { rowIndex: 7, columnIndex: 3, content: "86" },
        { rowIndex: 7, columnIndex: 4, content: "PASSED" },

        { rowIndex: 8, columnIndex: 0, content: "SPECIALIZED" },
        { rowIndex: 8, columnIndex: 1, content: "Basic Calculus 88" },
        { rowIndex: 8, columnIndex: 2, content: "98" },
        { rowIndex: 8, columnIndex: 3, content: "93" },
        { rowIndex: 8, columnIndex: 4, content: "PASSED" },

        { rowIndex: 9, columnIndex: 0, content: "SPECIALIZED" },
        { rowIndex: 9, columnIndex: 1, content: "General Chemistry 2 78" },
        { rowIndex: 9, columnIndex: 2, content: "81" },
        { rowIndex: 9, columnIndex: 3, content: "80" },
        { rowIndex: 9, columnIndex: 4, content: "PASSED" },

        // Footer
        { rowIndex: 10, columnIndex: 0, content: "General Ave. for the Semester" },
        { rowIndex: 10, columnIndex: 4, content: "86.8" },
      ],
    };

    const azTableResult = parseAzureLayoutGrades([azureSem2Table]);
    assert.equal(azTableResult.sem2_general_average, 86.8);
    const azSem2Grades = azTableResult.grades.filter((g) => g.semester === "2nd Semester");
    assert.equal(azSem2Grades.length, 9, "Azure Layout table must extract all 9 subjects");

    const azPe = azSem2Grades.find((g) => g.subject === "Physical Education and Health 2");
    assert.ok(azPe, "Must find Physical Education and Health 2 with cleaned title");
    assert.equal(azPe.q3, 95);
    assert.equal(azPe.q4, 75);
    assert.equal(azPe.final, 85);

    const azStat = azSem2Grades.find((g) => g.subject === "Statistics and Probability");
    assert.ok(azStat);
    assert.equal(azStat.q3, 86);
    assert.equal(azStat.q4, 87);
    assert.equal(azStat.final, 87);

    const azDrrr = azSem2Grades.find((g) => g.subject === "Disaster Readiness and Risk Reduction");
    assert.ok(azDrrr);
    assert.equal(azDrrr.q3, 91);
    assert.equal(azDrrr.q4, 93);
    assert.equal(azDrrr.final, 92);

    const azPr1 = azSem2Grades.find((g) => g.subject === "Practical Research 1");
    assert.ok(azPr1);
    assert.equal(azPr1.q3, 84);
    assert.equal(azPr1.q4, 87);
    assert.equal(azPr1.final, 86);

    const azBc = azSem2Grades.find((g) => g.subject === "Basic Calculus");
    assert.ok(azBc);
    assert.equal(azBc.q3, 88);
    assert.equal(azBc.q4, 98);
    assert.equal(azBc.final, 93);

    const azGc2 = azSem2Grades.find((g) => g.subject === "General Chemistry 2");
    assert.ok(azGc2);
    assert.equal(azGc2.q3, 78);
    assert.equal(azGc2.q4, 81);
    assert.equal(azGc2.final, 80);
  });

  await t.test("2f-3. roundSf10GeneralAverage whole-number rounding (.5-.9 up, .0-.4 down) and SF10 shs_semesters average mapping", () => {
    // 1. Assert helper rounding rules
    assert.equal(roundSf10GeneralAverage(86.5), 87, "86.5 must round up to 87");
    assert.equal(roundSf10GeneralAverage(86.8), 87, "86.8 must round up to 87");
    assert.equal(roundSf10GeneralAverage(86.4), 86, "86.4 must round down to 86");
    assert.equal(roundSf10GeneralAverage(89.9), 90, "89.9 must round up to 90");
    assert.equal(roundSf10GeneralAverage(86.0), 86, "86.0 must round to 86");
    assert.equal(roundSf10GeneralAverage("86.5"), 87, "String '86.5' must round to 87");
    assert.equal(roundSf10GeneralAverage("86.4"), 86, "String '86.4' must round to 86");
    assert.equal(roundSf10GeneralAverage(null), null);
    assert.equal(roundSf10GeneralAverage(undefined), null);
    assert.equal(roundSf10GeneralAverage("—"), null);

    // 2. Simulate SF10 parsed payload with 18 subjects
    const mockSf10Parsed = {
      shs_semesters: [
        {
          semester: "1st Semester",
          generalAverage: roundSf10GeneralAverage(86.5) ?? 87,
          general_average: roundSf10GeneralAverage(86.5) ?? 87,
          subjects: [
            { subject: "Oral Communication", q1: 85, q2: 87, finalGrade: 86, sem_final_grade: 86, action_taken: "PASSED" },
            { subject: "Komunikasyon at Pananaliksik", q1: 86, q2: 84, finalGrade: 85, sem_final_grade: 85, action_taken: "PASSED" },
            { subject: "General Mathematics", q1: 88, q2: 86, finalGrade: 87, sem_final_grade: 87, action_taken: "PASSED" },
            { subject: "Earth and Life Science", q1: 89, q2: 87, finalGrade: 88, sem_final_grade: 88, action_taken: "PASSED" },
            { subject: "Personal Development", q1: 90, q2: 92, finalGrade: 91, sem_final_grade: 91, action_taken: "PASSED" },
            { subject: "Understanding Culture, Society and Politics", q1: 84, q2: 86, finalGrade: 85, sem_final_grade: 85, action_taken: "PASSED" },
            { subject: "Physical Education and Health 1", q1: 87, q2: 89, finalGrade: 88, sem_final_grade: 88, action_taken: "PASSED" },
            { subject: "Empowerment Technologies", q1: 86, q2: 88, finalGrade: 87, sem_final_grade: 87, action_taken: "PASSED" },
            { subject: "Pre-Calculus", q1: 85, q2: 87, finalGrade: 86, sem_final_grade: 86, action_taken: "PASSED" },
          ],
        },
        {
          semester: "2nd Semester",
          generalAverage: roundSf10GeneralAverage(86.8) ?? 87,
          general_average: roundSf10GeneralAverage(86.8) ?? 87,
          subjects: [
            { subject: "Reading and Writing", q3: 70, q4: 98, finalGrade: 84, sem_final_grade: 84, action_taken: "PASSED" },
            { subject: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", q3: 80, q4: 80, finalGrade: 80, sem_final_grade: 80, action_taken: "PASSED" },
            { subject: "Personal Development (Pansariling Kaunlaran)", q3: 90, q4: 90, finalGrade: 90, sem_final_grade: 90, action_taken: "PASSED" },
            { subject: "Physical Education and Health 2", q3: 95, q4: 75, finalGrade: 85, sem_final_grade: 85, action_taken: "PASSED" },
            { subject: "Statistics and Probability", q3: 86, q4: 87, finalGrade: 87, sem_final_grade: 87, action_taken: "PASSED" },
            { subject: "Disaster Readiness and Risk Reduction", q3: 91, q4: 93, finalGrade: 92, sem_final_grade: 92, action_taken: "PASSED" },
            { subject: "Practical Research 1", q3: 84, q4: 87, finalGrade: 86, sem_final_grade: 86, action_taken: "PASSED" },
            { subject: "Basic Calculus", q3: 88, q4: 98, finalGrade: 93, sem_final_grade: 93, action_taken: "PASSED" },
            { subject: "General Chemistry 2", q3: 78, q4: 81, finalGrade: 80, sem_final_grade: 80, action_taken: "PASSED" },
          ],
        },
      ],
    };

    // Assert both semesters have exactly 9 subjects completely unchanged
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects.length, 9);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects.length, 9);

    // Verify Sem 1 subjects & grades unchanged
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects[0].subject, "Oral Communication");
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects[0].q1, 85);
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects[0].q2, 87);
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects[0].finalGrade, 86);
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects[8].subject, "Pre-Calculus");
    assert.equal(mockSf10Parsed.shs_semesters[0].subjects[8].finalGrade, 86);

    // Verify Sem 2 subjects & grades unchanged
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[0].subject, "Reading and Writing");
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[0].q3, 70);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[0].q4, 98);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[0].finalGrade, 84);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[3].subject, "Physical Education and Health 2");
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[3].q3, 95);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[3].q4, 75);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[3].finalGrade, 85);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[8].subject, "General Chemistry 2");
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[8].q3, 78);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[8].q4, 81);
    assert.equal(mockSf10Parsed.shs_semesters[1].subjects[8].finalGrade, 80);

    // Assert General Averages rounded to whole number 87 (from 86.5 and 86.8)
    assert.equal(mockSf10Parsed.shs_semesters[0].generalAverage, 87);
    assert.equal(mockSf10Parsed.shs_semesters[1].generalAverage, 87);
  });

  await t.test("2g. OCR Readability Confidence & Field Completeness metrics calculation", () => {
    // Azure 0.9412 -> 94%
    const m1 = calculateOcrMetrics(0.9412, {
      document_type: "sf10",
      lrn: "111304501972",
      last_name: "GOMEZ",
      first_name: "JUSTIN",
      birth_date: "2004-06-23",
      school_name: "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
      grade_level: "Grade 11",
      track_strand: "Academic - STEM",
      grades: [{ subject: "Oral Communication" }],
    });
    assert.equal(m1.ocrConfidencePercent, 94);
    assert.equal(m1.extractedFieldCompletenessPercent, 100);

    // Excel 1.0 -> 100%
    const m2 = calculateOcrMetrics(1.0, {
      document_type: "sf10",
      lrn: "111304501972",
      grades: [{ subject: "Oral Communication" }],
    });
    assert.equal(m2.ocrConfidencePercent, 100);

    // Partial fields completeness
    const m3 = calculateOcrMetrics(0.82, {
      document_type: "sf10",
      lrn: "111304501972",
      last_name: "GOMEZ",
      first_name: "JUSTIN",
      birth_date: "2004-06-23",
    });
    assert.equal(m3.ocrConfidencePercent, 82);
    assert.equal(m3.extractedFieldCompletenessPercent, 50); // 4 out of 8 fields
  });

  // ---------------------------------------------------------------------------
  // 3. Cross-Document Comparisons (SF10 <-> SF1, SF9, PSA)
  // ---------------------------------------------------------------------------
  const sf10Doc = {
    document_id: "doc-sf10",
    last_name: "GOMEZ",
    first_name: "JUSTIN",
    middle_name: "LOQUILLANO",
    lrn: "111304501972",
    birth_date: "2004-06-23",
    sex: "Male",
    scholastic_records: [
      {
        school_id: "500619",
        grade_level: "Grade 11",
        school_year: "2019-2020",
        semester: "1st Semester",
        track_strand: "Academic - STEM",
        section: "Rizal",
        general_average: 86.5,
        subjects: [
          { subject: "Oral Communication", q1: 85, q2: 87, sem_final_grade: 86 },
          { subject: "General Mathematics", q1: 88, q2: 86, sem_final_grade: 87 },
        ],
      },
      {
        school_id: "500619",
        grade_level: "Grade 11",
        school_year: "2019-2020",
        semester: "2nd Semester",
        track_strand: "Academic - STEM",
        section: "Rizal",
        general_average: 86.8,
        subjects: [{ subject: "Reading and Writing", q3: 86, q4: 88, sem_final_grade: 87 }],
      },
    ],
  };

  await t.test("3a. SF10 <-> SF1 compares LRN, Full Name, Sex, and normalized Birth Date", () => {
    const matchingSf1 = {
      document_id: "doc-sf1",
      last_name: "GOMEZ",
      first_name: "JUSTIN",
      middle_name: "LOQUILLANO",
      lrn: "111304501972",
      birth_date: "6/23/04", // SF1 M/D/YY format
      sex: "M",
    };

    const res = compareSf10AndSf1(sf10Doc, matchingSf1);
    assert.equal(res.status, "MATCH", "Matching SF10 and SF1 must result in MATCH");
    assert.equal(res.discrepancies.length, 0);

    // Mismatched LRN
    const mismatchLrn = { ...matchingSf1, lrn: "111304501999" };
    const resLrn = compareSf10AndSf1(sf10Doc, mismatchLrn);
    assert.equal(resLrn.status, "MISMATCH");
    assert.ok(resLrn.discrepancies.some((d) => d.field === "lrn"));

    // Mismatched birth date
    const mismatchDob = { ...matchingSf1, birth_date: "7/23/04" };
    const resDob = compareSf10AndSf1(sf10Doc, mismatchDob);
    assert.equal(resDob.status, "MISMATCH");
    assert.ok(resDob.discrepancies.some((d) => d.field === "birth_date"));
  });

  await t.test("3b. SF10 <-> PSA compares civil identity ONLY (Full Name, Sex, Birth Date; NO LRN on PSA)", () => {
    const matchingPsa = {
      document_id: "doc-psa",
      first_name: "JUSTIN",
      middle_name: "LOQUILLANO",
      last_name: "GOMEZ",
      birth_date: "June 23, 2004", // PSA long textual date
      sex: "MALE",
    };

    const res = compareSf10AndPsa(sf10Doc, matchingPsa);
    assert.equal(res.status, "MATCH", "Matching civil identity must yield MATCH");
    assert.equal(res.discrepancies.length, 0);

    // Ensure PSA lacking LRN does NOT flag an LRN mismatch
    assert.ok(!res.comparisonResults.some((c) => c.field === "lrn"), "PSA must not compare LRN");

    // Mismatched surname
    const mismatchLast = { ...matchingPsa, last_name: "REYES" };
    const resLast = compareSf10AndPsa(sf10Doc, mismatchLast);
    assert.equal(resLast.status, "MISMATCH");
    assert.ok(resLast.discrepancies.some((d) => d.field === "full_name"));
  });

  await t.test("3c. SF10 <-> SF9 compares Identity, Scholastic Context, per-semester Subject Grades & General Averages", () => {
    const matchingSf9 = {
      document_id: "doc-sf9",
      name: "GOMEZ, JUSTIN LOQUILLANO",
      lrn: "111304501972",
      sex: "Male",
      grade_level: "Grade 11",
      school_year: "2019-2020",
      section: "Rizal",
      track_strand: "STEM",
      grades: [
        { subject: "Oral Communication", semester: "1st Semester", q1: 85, q2: 87, final: 86 },
        { subject: "General Mathematics", semester: "1st Semester", q1: 88, q2: 86, final: 87 },
        { subject: "Reading and Writing", semester: "2nd Semester", q3: 86, q4: 88, final: 87 },
      ],
      sem1_general_average: 86.5,
      sem2_general_average: 86.8,
    };

    const res = compareSf10AndSf9(sf10Doc, matchingSf9);
    assert.equal(res.status, "MATCH", "Matching SF10 and SF9 must result in MATCH");

    // Discrepant grade in Oral Communication (SF10 has 86, SF9 has 89)
    const mismatchSf9Grade = {
      ...matchingSf9,
      grades: [
        { subject: "Oral Communication", semester: "1st Semester", q1: 88, q2: 90, final: 89 },
        { subject: "General Mathematics", semester: "1st Semester", q1: 88, q2: 86, final: 87 },
        { subject: "Reading and Writing", semester: "2nd Semester", q3: 86, q4: 88, final: 87 },
      ],
    };
    const resGrade = compareSf10AndSf9(sf10Doc, mismatchSf9Grade);
    assert.equal(resGrade.status, "MISMATCH");
    assert.ok(resGrade.discrepancies.some((d) => d.field.includes("grade") || d.description.includes("Oral Communication")));

    // Discrepant General Average
    const mismatchSf9Ga = {
      ...matchingSf9,
      sem1_general_average: 88.0,
    };
    const resGa = compareSf10AndSf9(sf10Doc, mismatchSf9Ga);
    assert.equal(resGa.status, "MISMATCH");
    assert.ok(resGa.discrepancies.some((d) => d.field.includes("general_average")));
  });

  // ---------------------------------------------------------------------------
  // 4. Universal Birthdate Shuffling (PSA YYYY/MM/DD <-> SF1 MM/DD/YYYY)
  // ---------------------------------------------------------------------------
  await t.test("4a. Shuffles PSA YYYY/MM/DD and SF1 MM/DD/YYYY / M/D/YY into canonical MM/DD/YYYY and YYYY/MM/DD", () => {
    // PSA format YYYY/MM/DD
    const psaShuffled = shuffleBirthDate("2004/06/23");
    assert.ok(psaShuffled, "PSA date must shuffle");
    assert.equal(psaShuffled.mmDdYyyy, "06/23/2004");
    assert.equal(psaShuffled.yyyyMmDd, "2004/06/23");
    assert.equal(psaShuffled.iso, "2004-06-23");

    // PSA format YYYY-MM-DD
    const psaIsoShuffled = shuffleBirthDate("2004-06-23");
    assert.ok(psaIsoShuffled);
    assert.equal(psaIsoShuffled.mmDdYyyy, "06/23/2004");
    assert.equal(psaIsoShuffled.yyyyMmDd, "2004/06/23");

    // SF1 format M/D/YY
    const sf1Shuffled = shuffleBirthDate("6/23/04");
    assert.ok(sf1Shuffled, "SF1 date must shuffle");
    assert.equal(sf1Shuffled.mmDdYyyy, "06/23/2004");
    assert.equal(sf1Shuffled.yyyyMmDd, "2004/06/23");
    assert.equal(sf1Shuffled.iso, "2004-06-23");

    // Formatted display with doc label
    const psaDisplay = formatBirthDateWithDocLabel("2004/06/23", "PSA");
    assert.equal(psaDisplay, "06/23/2004 (PSA: 2004/06/23)");

    const sf1Display = formatBirthDateWithDocLabel("6/23/04", "SF1");
    assert.equal(sf1Display, "06/23/2004 (SF1: 6/23/04)");

    const sf9Display = formatBirthDateWithDocLabel("06/23/2004", "SF9");
    assert.equal(sf9Display, "06/23/2004 (SF9)");

    // Comparison between PSA and SF1 yields MATCH
    const dobMatch = compareBirthDates("2004/06/23", "6/23/04");
    assert.equal(dobMatch.outcome, "MATCH", "PSA YYYY/MM/DD and SF1 M/D/YY must match");
  });

  // ---------------------------------------------------------------------------
  // 5. Strict 4-State Row Evaluation (MATCH, MISMATCH, INCOMPLETE, NO DATA)
  // ---------------------------------------------------------------------------
  await t.test("5a. evaluate4StateRowStatus strictly adheres to 4-state evaluation", () => {
    // 1. NO DATA: 0 documents have a value (all —)
    const noDataRow = {
      field: "school_id",
      label: "DepEd School ID",
      category: "IDENTITY",
      status: "MATCH",
      psaValue: "—",
      sf1Value: "—",
      sf2Value: "—",
      sf9Value: "—",
      sf10Value: "—",
    };
    assert.equal(evaluate4StateRowStatus(noDataRow), "NO DATA");

    // 2. INCOMPLETE: Only 1 applicable document has a value
    const incompleteRow = {
      field: "track_strand",
      label: "Track & Strand",
      category: "ACADEMIC",
      status: "MATCH",
      psaValue: "—",
      sf1Value: "TVL - CSS",
      sf2Value: "—",
      sf9Value: "—",
      sf10Value: "—",
    };
    assert.equal(evaluate4StateRowStatus(incompleteRow), "INCOMPLETE");

    // 3. MATCH: At least 2 documents agree after normalization
    const matchRow = {
      field: "birth_date",
      label: "Date of Birth",
      category: "IDENTITY",
      status: "MATCH",
      psaValue: "2004/06/23",
      sf1Value: "6/23/04",
      sf2Value: "—",
      sf9Value: "06/23/2004",
      sf10Value: "06/23/2004",
    };
    assert.equal(evaluate4StateRowStatus(matchRow), "MATCH");

    // 4. MISMATCH: At least 2 documents disagree
    const mismatchLrnRow = {
      field: "lrn",
      label: "Learner Reference Number (LRN)",
      category: "IDENTITY",
      status: "MISMATCH",
      psaValue: "—",
      sf1Value: "111500619123",
      sf2Value: "—",
      sf9Value: "—",
      sf10Value: "111304501972",
    };
    assert.equal(evaluate4StateRowStatus(mismatchLrnRow), "MISMATCH");
  });

  // ---------------------------------------------------------------------------
  // 6. Unified 5-Document Dossier for Justin Gomez (SF1, SF2, SF9, SF10, PSA)
  // ---------------------------------------------------------------------------
  await t.test("6a. Merges PSA, SF1, SF2 (no LRN), SF9, SF10 into ONE unified learner dossier despite LRN/section conflicts", () => {
    const report = evaluateBatchCrossDocumentValidation({
      batchId: "batch-justin-gomez-unify",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "CSS 1",
      segments: [
        { id: "seg-sf1", documentType: "sf1", pageRange: [1, 1], confidence: 0.99 },
        { id: "seg-sf2", documentType: "sf2", pageRange: [2, 2], confidence: 0.98 },
        { id: "seg-sf9", documentType: "sf9", pageRange: [3, 4], confidence: 0.97 },
        { id: "seg-sf10", documentType: "sf10", pageRange: [5, 6], confidence: 0.98 },
        { id: "seg-psa", documentType: "birth_cert", pageRange: [7, 7], confidence: 0.99 },
      ],
      extractedSegmentData: {
        "seg-sf1": {
          learners: [
            {
              lrn: "111500619123", // Conflicting LRN in SF1
              lastName: "GOMEZ",
              firstName: "JUSTIN",
              middleName: "LOQUILLANO",
              birthDate: "6/23/04",
              sex: "M",
              section: "CSS 1",
            },
          ],
        },
        "seg-sf2": {
          learners: [
            {
              // SF2 has NO LRN
              name: "GOMEZ, JUSTIN L.",
              lastName: "GOMEZ",
              firstName: "JUSTIN",
              middleName: "LOQUILLANO",
              sex: "M",
              attendance: {
                summary: { present: 21, absent: 0, total: 21 },
                jun: { present: 21, absent: 0, total: 21 },
              },
            },
          ],
        },
        "seg-sf9": {
          learner: {
            lrn: "111304501972",
            name: "GOMEZ, JUSTIN LOQUILLANO",
            lastName: "GOMEZ",
            firstName: "JUSTIN",
            middleName: "LOQUILLANO",
            birthDate: "06/23/2004",
            sex: "Male",
            section: "Rizal",
            general_average: 88,
            sem1_general_average: 88,
            grades: [{ subject: "Oral Communication", final: 88 }],
          },
        },
        "seg-sf10": {
          learner: {
            lrn: "111304501972", // Conflicting LRN in SF10
            lastName: "GOMEZ",
            firstName: "JUSTIN",
            middleName: "LOQUILLANO",
            birthDate: "06/23/2004",
            sex: "MALE",
            section: "Rizal",
          },
        },
        "seg-psa": {
          candidate: {
            lastName: "GOMEZ",
            firstName: "JUSTIN",
            middleName: "LOQUILLANO",
            birthDate: "2004/06/23", // PSA YYYY/MM/DD
            sex: "MALE",
          },
        },
      },
    });

    // Verify all 5 documents merged into EXACTLY 1 learner dossier
    assert.equal(report.summary.totalLearnersDetected, 1, "Must merge all 5 documents for Gomez into exactly 1 learner dossier");
    assert.equal(report.learnerDossiers.length, 1);

    const dossier = report.learnerDossiers[0];
    assert.equal(dossier.fullName, "GOMEZ, JUSTIN LOQUILLANO");

    // All 5 document records must be populated
    assert.ok(dossier.documentPresence.sf1, "SF1 record must be attached");
    assert.ok(dossier.documentPresence.sf2, "SF2 record must be attached");
    assert.ok(dossier.documentPresence.sf9, "SF9 record must be attached");
    assert.ok(dossier.documentPresence.sf10, "SF10 record must be attached");
    assert.ok(dossier.documentPresence.psa, "PSA record must be attached");

    // Check Cross-Document Matrix rows
    const matrix = dossier.unifiedMatrix;
    assert.ok(matrix.length > 0, "Cross-Document Matrix must be populated");

    // LRN row must show MISMATCH because SF1 has 111500619123 and SF10 has 111304501972
    const lrnRow = matrix.find((r) => r.field === "lrn");
    assert.ok(lrnRow, "LRN row must exist in matrix");
    assert.equal(lrnRow.sf1Value, "111500619123");
    assert.equal(lrnRow.sf10Value, "111304501972");
    assert.equal(lrnRow.status, "MISMATCH", "Differing LRNs in SF1 vs SF10 must be flagged as MISMATCH");

    // Birth Date row must MATCH across PSA (2004/06/23), SF1 (6/23/04), SF9 (06/23/2004), SF10 (06/23/2004)
    const dobRow = matrix.find((r) => r.field === "birth_date");
    assert.ok(dobRow, "Birth Date row must exist in matrix");
    assert.equal(dobRow.status, "MATCH", "Normalized birth dates must match across all documents");
  });

  // -------------------------------------------------------------------------
  // 7. Dynamic Grade Status & Cross-Document Matching Suite
  // -------------------------------------------------------------------------
  await t.test("7a. SF10 Scholastic Records dynamic evaluation: Blank cells never default to PASSED, low-confidence triggers Not Recognized", () => {
    const syntheticRecords = [
      {
        grade_level: "Grade 11",
        semester: "1st Semester",
        school_year: "2019-2020",
        subjects: [
          // Blank final cell
          { subject: "Oral Communication", sem_final_grade: undefined },
          // Passed clear numeric grade (88 >= 75)
          { subject: "General Mathematics", sem_final_grade: 88, confidence: 0.95 },
          // Failed clear numeric grade (71 < 75)
          { subject: "Physical Science", sem_final_grade: 71, confidence: 0.95 },
          // Low confidence reading (< 65%)
          { subject: "Earth and Life Science", sem_final_grade: 90, confidence: 0.52 },
        ],
      },
    ];

    const gradeRows = sf10RecordsToGradeRows(syntheticRecords);
    assert.equal(gradeRows.length, 4);

    // 1. Blank final cell -> status: 'Missing', action_taken: undefined, remarks: 'Blank / Incomplete'
    const blankRow = gradeRows[0];
    assert.equal(blankRow.final, undefined);
    assert.equal(blankRow.status, "Missing");
    assert.equal(blankRow.action_taken, undefined);
    assert.equal(blankRow.remarks, "Blank / Incomplete");
    assert.notEqual(blankRow.status, "Passed");
    assert.notEqual(blankRow.action_taken, "PASSED");

    // 2. Passed numeric grade
    const passRow = gradeRows[1];
    assert.equal(passRow.final, 88);
    assert.equal(passRow.status, "Passed");
    assert.equal(passRow.action_taken, "PASSED");
    assert.equal(passRow.remarks, "PASSED");

    // 3. Failed numeric grade
    const failRow = gradeRows[2];
    assert.equal(failRow.final, 71);
    assert.equal(failRow.status, "Failed");
    assert.equal(failRow.action_taken, "FAILED");
    assert.equal(failRow.remarks, "FAILED");

    // 4. Low confidence reading -> status: 'Not Recognized', action_taken: 'NOT RECOGNIZED', remarks: 'Not Recognized (52%)'
    const lowConfRow = gradeRows[3];
    assert.equal(lowConfRow.status, "Not Recognized");
    assert.equal(lowConfRow.action_taken, "NOT RECOGNIZED");
    assert.equal(lowConfRow.remarks, "Not Recognized (52%)");
    assert.notEqual(lowConfRow.status, "Passed");
    assert.notEqual(lowConfRow.action_taken, "PASSED");
  });

  await t.test("7b. SF10 <-> SF9 cross-document comparison: Blank and Not Recognized cells are never counted as verified MATCH", () => {
    // SF10 has populated Oral Communication grade (86), but SF9 has blank grade
    const sf10WithOral = {
      document_id: "doc-sf10",
      school_year: "2019-2020",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", schoolYear: "2019-2020", gradeLevel: "Grade 11", semester: "1st Semester", finalGrade: 86 },
      ],
      completed_semesters: [],
    };

    const sf9WithBlankOral = {
      document_id: "doc-sf9",
      school_year: "2019-2020",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", schoolYear: "2019-2020", gradeLevel: "Grade 11", semester: "1st Semester", finalGrade: null },
      ],
    };

    const res = compareSf10AndSf9(sf10WithOral, sf9WithBlankOral);
    const oralComparison = res.comparisonResults.find((c) => /oral[_\s]communication/i.test(c.field));
    assert.ok(oralComparison, "Oral Communication comparison result must exist");
    assert.equal(oralComparison.isMatch, false, "Blank SF9 grade cell must NEVER match a populated SF10 grade");
    assert.ok(res.discrepancies.length > 0, "Must flag discrepancy for blank grade cell");

    // Low confidence SF9 grade (e.g. confidence = 0.52) must also NEVER be counted as MATCH
    const sf9WithLowConfOral = {
      document_id: "doc-sf9",
      school_year: "2019-2020",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", schoolYear: "2019-2020", gradeLevel: "Grade 11", semester: "1st Semester", finalGrade: 86, confidence: 0.52 },
      ],
    };

    const resLow = compareSf10AndSf9(sf10WithOral, sf9WithLowConfOral);
    const lowComparison = resLow.comparisonResults.find((c) => /oral[_\s]communication/i.test(c.field));
    assert.ok(lowComparison);
    assert.equal(lowComparison.isMatch, false, "Low-confidence OCR grade reading must NOT be counted as verified MATCH");
    assert.ok(lowComparison.notes.includes("low confidence") || lowComparison.notes.includes("not recognized"));
  });

  // ---------------------------------------------------------------------------
  // 8. Batch Cross-Document: Non-consecutive School Year and Strict Sex Mismatch
  // ---------------------------------------------------------------------------
  await t.test("8. Batch Cross-Document: Non-consecutive School Year flags CRITICAL mismatch", () => {
    const invalidBatchSegments = [
      {
        id: "seg-sf9-1",
        documentType: "sf9",
        pageNumber: 1,
        fileName: "SF9_Sample.pdf",
        confidence: 0.95,
        extractedData: {
          lrn: "123456789012",
          last_name: "DELA CRUZ",
          first_name: "JUAN",
          sex: "Male",
          school_year: "2025-2027", // Non-consecutive!
          grade_level: "Grade 11",
          section: "STEM-A",
          general_average: 88,
          grades: [],
        },
      },
    ];

    const report = evaluateBatchCrossDocumentValidation({
      segments: invalidBatchSegments,
      extractedSegmentData: {
        "seg-sf9-1": invalidBatchSegments[0].extractedData,
      },
    });

    const syDisc = report.categorizedResults.mismatchedInformation.find((d) => d.field === "School Year Format / Sequence");
    assert.ok(syDisc, "Must flag non-consecutive School Year discrepancy");
    assert.equal(syDisc.severity, "CRITICAL");
    assert.equal(syDisc.category, "MISMATCH");
    assert.ok(syDisc.reason.includes("Non-consecutive") || syDisc.reason.includes("non-consecutive"));
  });

  // ---------------------------------------------------------------------------
  // 9. PSA Item 2 Sex Detection & Strict Prefix/Code Snapping (Ma/M/1 -> Male, Fe/F/2 -> Female)
  // ---------------------------------------------------------------------------
  await t.test("9. PSA Item 2 Sex Detection & Strict Normalization (X placement before 1 Male vs 2 Female)", () => {
    // A. normalizeStrictSex prefix/code snapping
    assert.equal(normalizeStrictSex("Ma"), "Male");
    assert.equal(normalizeStrictSex("M"), "Male");
    assert.equal(normalizeStrictSex("1"), "Male");
    assert.equal(normalizeStrictSex("1 Male"), "Male");
    assert.equal(normalizeStrictSex("1-Male"), "Male");
    assert.equal(normalizeStrictSex("1. Male"), "Male");
    assert.equal(normalizeStrictSex("Fe"), "Female");
    assert.equal(normalizeStrictSex("F"), "Female");
    assert.equal(normalizeStrictSex("2"), "Female");
    assert.equal(normalizeStrictSex("2 Female"), "Female");
    assert.equal(normalizeStrictSex("2-Female"), "Female");
    assert.equal(normalizeStrictSex("2. Female"), "Female");
    assert.equal(normalizeStrictSex(""), null);

    // B. PSA Item 2 Underline Mark Placement
    const maleDoc = `
PHILIPPINE STATISTICS AUTHORITY
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN GOMEZ
2. SEX
___X___ 1 Male    _______ 2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
    const maleRes = parsePsaBirthCert(maleDoc);
    assert.equal(maleRes.identity.sex, "M");
    assert.equal(maleRes.identity.sex_label, "Male");
    assert.equal(maleRes.field_statuses.sex.status, "extracted");
    assert.ok(maleRes.field_statuses.sex.confidence >= 85);

    const femaleDoc = `
PHILIPPINE STATISTICS AUTHORITY
CERTIFICATE OF LIVE BIRTH
1. NAME: MARIA GOMEZ
2. SEX
_______ 1 Male    ___X___ 2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
    const femaleRes = parsePsaBirthCert(femaleDoc);
    assert.equal(femaleRes.identity.sex, "F");
    assert.equal(femaleRes.identity.sex_label, "Female");
    assert.equal(femaleRes.field_statuses.sex.status, "extracted");
    assert.ok(femaleRes.field_statuses.sex.confidence >= 85);

    // C. Slash / Checkmark mark placement
    const slashMale = extractPsaSexFromMarkPlacement("/ 1 Male 2 Female");
    assert.equal(slashMale.sex, "M");
    assert.equal(slashMale.sexLabel, "Male");

    const slashFemale = extractPsaSexFromMarkPlacement("1 Male / 2 Female");
    assert.equal(slashFemale.sex, "F");
    assert.equal(slashFemale.sexLabel, "Female");

    const checkMale = extractPsaSexFromMarkPlacement("✓ 1 Male 2 Female");
    assert.equal(checkMale.sex, "M");
    assert.equal(checkMale.sexLabel, "Male");

    // D. Unmarked Form 102 line must NOT trigger false positive on '2' from '2 Female'
    const unmarkedDoc = `
PHILIPPINE STATISTICS AUTHORITY
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN GOMEZ
2. SEX
_______ 1 Male    _______ 2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
    const unmarkedRes = parsePsaBirthCert(unmarkedDoc);
    assert.equal(unmarkedRes.identity.sex, undefined);
    assert.equal(unmarkedRes.field_statuses.sex.status, "not_detected");
    assert.equal(unmarkedRes.field_statuses.sex.confidence, 0);
  });

  // ---------------------------------------------------------------------------
  // 6. SF10-SHS Single-Page Extraction: Sem 1 & Sem 2, Merged Quarters & Decimal Averages
  // ---------------------------------------------------------------------------
  await t.test("6a. Merged quarter string splitting (extractTwoQuarterGrades)", () => {
    assert.deepEqual(extractTwoQuarterGrades("88\n88"), [88, 88]);
    assert.deepEqual(extractTwoQuarterGrades("75\n95"), [75, 95]);
    assert.deepEqual(extractTwoQuarterGrades("70 98"), [70, 98]);
    assert.deepEqual(extractTwoQuarterGrades("85\r\n87"), [85, 87]);
    assert.equal(extractTwoQuarterGrades("85"), null);
    assert.equal(extractTwoQuarterGrades("—"), null);
    assert.equal(extractTwoQuarterGrades(null), null);
  });

  await t.test("6b. Decimal General Average evaluation (86.5 & 86.8)", () => {
    const sem1Eval = evaluateDynamicGradeStatus({
      grade: 86.5,
      allowDecimal: true,
      isGeneralAverage: true,
      confidencePercent: 95,
    });
    assert.equal(sem1Eval.status, "passed");
    assert.equal(sem1Eval.officialRemark, "PASSED");
    assert.equal(sem1Eval.remarkDisplay, "PASSED");
    assert.equal(sem1Eval.gradeDisplay, "86.5");
    assert.equal(sem1Eval.numericGrade, 86.5);
    assert.equal(sem1Eval.confidencePercent, 95);

    const sem2Eval = evaluateDynamicGradeStatus({
      grade: 86.8,
      allowDecimal: true,
      isGeneralAverage: true,
      confidencePercent: 95,
    });
    assert.equal(sem2Eval.status, "passed");
    assert.equal(sem2Eval.officialRemark, "PASSED");
    assert.equal(sem2Eval.remarkDisplay, "PASSED");
    assert.equal(sem2Eval.gradeDisplay, "86.8");
    assert.equal(sem2Eval.numericGrade, 86.8);
    assert.equal(sem2Eval.confidencePercent, 95);
  });

  await t.test("6c. SF10-SHS Single-Page: Sem 1 (9 subjects) & Sem 2 (9 subjects) with merged quarters & empty remedial tables", () => {
    // Simulates the exact Azure table layout of SF10_SHS_Filled_From_SF9_Front_1Page.pdf
    const sem1Subjects = [
      ["Oral Communication", "88", "88", "88", "PASSED"],
      ["Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", "80", "80", "80", "PASSED"],
      ["Introduction to the Philosophy of the Human Person", "85", "85", "85", "PASSED"],
      ["Physical Education and Health 1", "90", "90", "90", "PASSED"],
      ["General Mathematics", "82", "82", "82", "PASSED"],
      ["Earth Science", "84", "84", "84", "PASSED"],
      ["Empowerment Technologies", "87", "87", "87", "PASSED"],
      ["Pre-Calculus", "86", "86", "86", "PASSED"],
      ["General Chemistry 1", "89", "89", "89", "PASSED"],
    ];

    const sem2Subjects = [
      ["Reading and Writing", "84\n84", "84", "PASSED"],
      ["Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", "80\n80", "80", "PASSED"],
      ["Personal Development", "90\n90", "90", "PASSED"],
      ["Physical Education and Health 2", "75\n95", "85", "PASSED"],
      ["Statistics and Probability", "70\n98", "84", "PASSED"],
      ["Disaster Readiness and Risk Reduction", "87\n87", "87", "PASSED"],
      ["Practical Research 1", "92\n92", "92", "PASSED"],
      ["Basic Calculus", "86\n86", "86", "PASSED"],
      ["General Chemistry 2", "93\n93", "93", "PASSED"],
    ];

    // Table 0: Sem 1 Scholastic Record Table (5 columns)
    const sem1Cells = [
      { rowIndex: 0, columnIndex: 0, content: "SCHOLASTIC RECORD SY: 2019-2020 | SEM: 1 | Grade 11" },
      { rowIndex: 1, columnIndex: 0, content: "Learning Areas" },
      { rowIndex: 1, columnIndex: 1, content: "1st" },
      { rowIndex: 1, columnIndex: 2, content: "2nd" },
      { rowIndex: 1, columnIndex: 3, content: "Sem Final Grade" },
      { rowIndex: 1, columnIndex: 4, content: "Action Taken" },
    ];
    sem1Subjects.forEach(([subj, q1, q2, fin, act], i) => {
      const r = i + 2;
      sem1Cells.push(
        { rowIndex: r, columnIndex: 0, content: subj },
        { rowIndex: r, columnIndex: 1, content: q1 },
        { rowIndex: r, columnIndex: 2, content: q2 },
        { rowIndex: r, columnIndex: 3, content: fin },
        { rowIndex: r, columnIndex: 4, content: act }
      );
    });
    // Sem 1 General Average Row
    const sem1AvgRow = sem1Subjects.length + 2;
    sem1Cells.push(
      { rowIndex: sem1AvgRow, columnIndex: 0, content: "General Ave. for the Semester" },
      { rowIndex: sem1AvgRow, columnIndex: 3, content: "86.5" }
    );

    const table0 = {
      rowCount: sem1AvgRow + 1,
      columnCount: 5,
      cells: sem1Cells,
      confidence: 0.95,
    };

    // Table 1: Empty Remedial Classes Table for Sem 1
    const table1 = {
      rowCount: 4,
      columnCount: 5,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "REMEDIAL CLASSES Conducted from" },
        { rowIndex: 1, columnIndex: 0, content: "Learning Areas" },
        { rowIndex: 1, columnIndex: 1, content: "Sem Final Grade" },
        { rowIndex: 1, columnIndex: 2, content: "Remedial Class Mark" },
        { rowIndex: 1, columnIndex: 3, content: "Recomputed Final Grade" },
        { rowIndex: 1, columnIndex: 4, content: "Action Taken" },
      ],
      confidence: 0.95,
    };

    // Table 2: Sem 2 Scholastic Record Table (4 columns, merged Quarter sub-columns)
    const sem2Cells = [
      { rowIndex: 0, columnIndex: 0, content: "SCHOLASTIC RECORD SY: 2019-2020 | SEM: 2 | Grade 11" },
      { rowIndex: 1, columnIndex: 0, content: "Learning Areas" },
      { rowIndex: 1, columnIndex: 1, content: "Quarter 3rd 4th" },
      { rowIndex: 1, columnIndex: 2, content: "Sem Final Grade" },
      { rowIndex: 1, columnIndex: 3, content: "Action Taken" },
    ];
    sem2Subjects.forEach(([subj, qMerged, fin, act], i) => {
      const r = i + 2;
      sem2Cells.push(
        { rowIndex: r, columnIndex: 0, content: subj },
        { rowIndex: r, columnIndex: 1, content: qMerged },
        { rowIndex: r, columnIndex: 2, content: fin },
        { rowIndex: r, columnIndex: 3, content: act }
      );
    });
    // Sem 2 General Average Row
    const sem2AvgRow = sem2Subjects.length + 2;
    sem2Cells.push(
      { rowIndex: sem2AvgRow, columnIndex: 0, content: "General Ave. for the Semester" },
      { rowIndex: sem2AvgRow, columnIndex: 2, content: "86.8" }
    );

    const table2 = {
      rowCount: sem2AvgRow + 1,
      columnCount: 4,
      cells: sem2Cells,
      confidence: 0.95,
    };

    // Table 3: Empty Remedial Classes Table for Sem 2
    const table3 = {
      rowCount: 4,
      columnCount: 5,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "REMEDIAL CLASSES Conducted from" },
        { rowIndex: 1, columnIndex: 0, content: "Learning Areas" },
        { rowIndex: 1, columnIndex: 1, content: "Sem Final Grade" },
        { rowIndex: 1, columnIndex: 2, content: "Remedial Class Mark" },
        { rowIndex: 1, columnIndex: 3, content: "Recomputed Final Grade" },
        { rowIndex: 1, columnIndex: 4, content: "Action Taken" },
      ],
      confidence: 0.95,
    };

    const layoutTables = [table0, table1, table2, table3];
    const parsed = parseAzureLayoutGrades(layoutTables);

    // 1. Both Semesters must be extracted (18 subjects total)
    assert.equal(parsed.grades.length, 18, "Must extract 18 total subjects (9 from Sem 1 + 9 from Sem 2)");

    const sem1Extracted = parsed.grades.filter((g) => g.semester === "1st Semester");
    const sem2Extracted = parsed.grades.filter((g) => g.semester === "2nd Semester");
    assert.equal(sem1Extracted.length, 9, "Must extract exactly 9 Sem 1 subjects");
    assert.equal(sem2Extracted.length, 9, "Must extract exactly 9 Sem 2 subjects (Sem 2 never discards Sem 1)");

    // 2. Sem 2 first 3 rows must be preserved
    assert.ok(sem2Extracted.some((g) => g.subject.includes("Reading and Writing")), "Must extract Reading and Writing");
    assert.ok(sem2Extracted.some((g) => g.subject.includes("Pagbasa at Pagsusuri")), "Must extract Pagbasa at Pagsusuri");
    assert.ok(sem2Extracted.some((g) => g.subject.includes("Personal Development")), "Must extract Personal Development");

    // 3. Merged quarter cell splitting: PE 2 has Q3=75, Q4=95, Sem Final=85
    const pe2 = sem2Extracted.find((g) => g.subject.includes("Physical Education and Health 2"));
    assert.ok(pe2, "PE 2 must be found in Sem 2");
    assert.equal(pe2.q3, 75, "PE 2 Q3 must be 75");
    assert.equal(pe2.q4, 95, "PE 2 Q4 must be 95 (split from merged cell)");
    assert.equal(pe2.sem2_final_grade, 85, "PE 2 Sem Final Grade must be strictly 85 (never shifted into 95)");
    assert.equal(pe2.final, 85, "PE 2 Final Grade must be 85");
    assert.equal(pe2.status, "Passed");

    // 4. Statistics and Probability: Q3=70, Q4=98, Sem Final=84
    const stats = sem2Extracted.find((g) => g.subject.includes("Statistics and Probability"));
    assert.ok(stats, "Stats must be found in Sem 2");
    assert.equal(stats.q3, 70, "Stats Q3 must be 70");
    assert.equal(stats.q4, 98, "Stats Q4 must be 98 (split from merged cell)");
    assert.equal(stats.sem2_final_grade, 84, "Stats Sem Final Grade must be 84");

    // 5. General Averages: 86.5 and 86.8
    assert.equal(parsed.sem1_general_average, 86.5, "Sem 1 General Average must be 86.5");
    assert.equal(parsed.sem2_general_average, 86.8, "Sem 2 General Average must be 86.8");
    assert.ok(parsed.sem1_confidence >= 85, "Sem 1 General Average confidence >= 85%");
    assert.ok(parsed.sem2_confidence >= 85, "Sem 2 General Average confidence >= 85%");
  });

  // ---------------------------------------------------------------------------
  // 7. Primary Source Student Data Reconciliation & Matrix Deduplication
  // ---------------------------------------------------------------------------
  await t.test("7. Primary Source reconciliation & Matrix validation without Mother's Maiden Name", () => {
    // 7a. Verify Mother's Maiden Name is absent from unified matrix & attendance rows deduplicated
    const outcome = evaluateUnifiedStudentValidation({
      lrn: "111500619123",
      fullName: "Gomez, Justin Loquillano",
      psa: {
        raw: {
          last_name: "GOMEZ",
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          sex: "Male",
          birth_date: "2004-06-23",
          mother_maiden_name: "MARIA SANTOS",
        },
      },
      sf1: {
        raw: {
          lrn: "111500619123",
          last_name: "GOMEZ",
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          sex: "Male",
          birth_date: "2004-06-23",
          school_id: "500169",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          track_strand: "STEM",
          parents_details: { mother_name: "MARIA LOURDES SANTOS" },
        },
      },
      sf2Records: [
        {
          raw: {
            month: "June",
            days_present: 21,
            days_absent: 0,
            total_school_days: 21,
          },
        },
      ],
      sf9: {
        raw: {
          school_id: "500169",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          attendance_months: ["June", "July"],
          attendance: [
            { label: "Total Days of School", values: [21, 22] },
            { label: "Days Present", values: [21, 22] },
            { label: "Days Absent", values: [0, 0] },
          ],
        },
      },
      sf10: {
        raw: {
          lrn: "111304501972", // Mismatched LRN on SF10
          last_name: "GOMES", // Mismatched surname on SF10
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          sex: "Male",
          birth_date: "2004-06-23",
          school_id: "500169",
          mother_name: "MARIA LOURDES SANTOS",
        },
      },
    });

    // 1. Mother's Maiden Name row must NOT exist in fieldsMatrix
    const motherRow = outcome.fieldsMatrix.find(
      (r) => r.field === "mother_maiden_name" || (r.label && r.label.includes("Mother"))
    );
    assert.equal(motherRow, undefined, "Mother's Maiden Name must be removed from cross-document matrix");

    // 2. Mother's name discrepancies must NOT exist
    const motherDisc = outcome.discrepancies.find(
      (d) => d.field === "mother_maiden_name" || d.field?.includes("mother")
    );
    assert.equal(motherDisc, undefined, "Mother's Maiden Name must not generate cross-document discrepancies");

    // 3. Monthly attendance rows must be deduplicated (at most 1 row per month)
    const juneRows = outcome.fieldsMatrix.filter(
      (r) => r.field === "attendance_june" || r.label === "Attendance — June (Jun)"
    );
    assert.equal(juneRows.length, 1, "June attendance row must appear at most once in matrix");

    // 4. Test reconcileStudentDataFromPrimarySources resolves MISMATCH and INCOMPLETE rows
    const mockDossier = {
      lrn: "111500619123",
      fullName: "Gomez, Justin Loquillano",
      lastName: "GOMEZ",
      firstName: "JUSTIN",
      middleName: "LOQUILLANO",
      sex: "Male",
      birthDate: "2004-06-23",
      overallStatus: "MISMATCH",
      documentPresence: {
        sf1: true,
        sf2: true,
        sf5: false,
        sf5a: false,
        sf5b: false,
        sf9: true,
        sf10: true,
        psa: true,
        totalAvailable: 5,
      },
      matchedSources: {
        sf1: {
          raw: {
            lrn: "111500619123",
            last_name: "GOMEZ",
            first_name: "JUSTIN",
            middle_name: "LOQUILLANO",
            sex: "Male",
            birth_date: "2004-06-23",
            school_id: "500169",
            school_year: "2024-2025",
            grade_level: "Grade 11",
            section: "Diamond",
            track_strand: "STEM",
          },
        },
        psa: {
          raw: {
            last_name: "GOMEZ",
            first_name: "JUSTIN",
            middle_name: "LOQUILLANO",
            sex: "Male",
            birth_date: "2004-06-23",
          },
        },
        sf2: {
          raw: {
            month: "June",
            days_present: 20,
            days_absent: 1,
            total_school_days: 21,
          },
        },
        sf9: {
          raw: {
            school_id: "500169",
            school_year: "2024-2025",
            grade_level: "Grade 11",
            section: "Diamond",
            general_average: 88.5,
          },
        },
        sf10: {
          raw: {
            lrn: "111304501972", // Mismatched LRN
            last_name: "GOMEZ",
            first_name: "JUSTIN",
            middle_name: "LOQUILLANO",
            general_average: null, // Incomplete
          },
        },
      },
      unifiedMatrix: [
        {
          field: "lrn",
          label: "Learner Reference Number (LRN)",
          category: "IDENTITY",
          sf1Value: "111500619123",
          sf2Value: "111500619123",
          sf9Value: "111500619123",
          sf10Value: "111304501972",
          psaValue: "Civil Document (No DepEd LRN)",
          status: "MISMATCH",
          isMatch: false,
        },
        {
          field: "general_average",
          label: "General Average",
          category: "ACADEMIC_PERFORMANCE",
          sf9Value: 88.5,
          sf10Value: undefined,
          status: "INCOMPLETE",
          isMatch: false,
        },
        {
          field: "attendance_june",
          label: "Attendance — June (Jun)",
          category: "ATTENDANCE",
          sf2Value: "Pres: 20, Abs: 1, Tot: 21",
          sf9Value: "Pres: 21, Abs: 0, Tot: 21",
          status: "MISMATCH",
          isMatch: false,
        },
      ],
      discrepancies: [
        {
          id: "disc-1",
          field: "lrn",
          reason: "LRN mismatch between SF1 and SF10",
          severity: "CRITICAL",
          category: "MISMATCH",
        },
      ],
    };

    const reconciled = reconcileStudentDataFromPrimarySources(mockDossier);

    // Reconciled matrix must turn all MISMATCH/INCOMPLETE rows into MATCH
    assert.equal(reconciled.overallStatus, "MATCH", "Overall status must be MATCH");
    assert.equal(reconciled.discrepancies.length, 0, "Discrepancies count must be 0");
    assert.ok(reconciled.unifiedMatrix.every((r) => r.status === "MATCH"), "All matrix rows must have status MATCH");
    assert.ok(reconciled.unifiedMatrix.every((r) => r.isMatch === true), "All matrix rows must have isMatch true");

    // LRN must be pulled from Primary Source SF1
    const lrnRow = reconciled.unifiedMatrix.find((r) => r.field === "lrn");
    assert.equal(lrnRow.sf10Value, "111500619123", "SF10 LRN must be overwritten with SF1 LRN");

    // General Average must be pulled from Primary Source SF9
    const gaRow = reconciled.unifiedMatrix.find((r) => r.field === "general_average");
    assert.equal(gaRow.sf10Value, 88.5, "SF10 General Average must be reconciled with SF9");

    // Audit log must reflect primary sources
    assert.ok(reconciled.reconciliationLog.length >= 2, "Must log all reconciled fields");
    const lrnLog = reconciled.reconciliationLog.find((l) => l.fieldName.includes("LRN"));
    assert.ok(lrnLog, "Must log LRN reconciliation");
    assert.equal(lrnLog.primarySource, "SF1", "LRN primarySource must be SF1");
    assert.equal(lrnLog.baselineValue, "111500619123", "LRN baselineValue must be SF1's LRN");

    const gaLog = reconciled.reconciliationLog.find((l) => l.fieldName.includes("General Average"));
    assert.ok(gaLog, "Must log General Average reconciliation");
    assert.equal(gaLog.primarySource, "SF9", "General Average primarySource must be SF9");

    // Alias check
    assert.equal(typeof reconcileStudentDataFromPrimaryKeys, "function", "Alias must exist");
  });

  // ---------------------------------------------------------------------------
  // 8. Cross-Document Matrix 18-Subject Mapping (Sem 1 + Sem 2) & Primary Source Reconciliation
  // ---------------------------------------------------------------------------
  await t.test("8. Cross-Document Matrix indexes all 18 subjects (Sem 1 + Sem 2) and NEVER fabricates 88 fallback", () => {
    // 8a. Verify ALL 18 subjects (9 Sem 1 + 9 Sem 2) from both SF9 and SF10 are indexed into the Cross-Document Matrix
    const sem1SubjectsSf9 = [
      { subject: "Oral Communication", final: 85, semester: "1st Semester" },
      { subject: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", final: 88, semester: "1st Semester" },
      { subject: "General Mathematics", final: 89, semester: "1st Semester" },
      { subject: "Earth and Life Science", final: 87, semester: "1st Semester" },
      { subject: "21st Century Literature from the Philippines and the World", final: 86, semester: "1st Semester" },
      { subject: "Introduction to the Philosophy of the Human Person", final: 90, semester: "1st Semester" },
      { subject: "Physical Education and Health 1", final: 85, semester: "1st Semester" },
      { subject: "Empowerment Technologies", final: 88, semester: "1st Semester" },
      { subject: "General Chemistry 1", final: 84, semester: "1st Semester" },
    ];

    const sem2SubjectsSf9 = [
      { subject: "Reading and Writing", final: 84, semester: "2nd Semester" },
      { subject: "Pagbasa at Pagsusuri ng Iba't-Ibang Teksto Tungo sa Pananaliksik", final: 80, semester: "2nd Semester" }, // Hyphenated variant
      { subject: "Personal Development/ Pansariling Kaunlaran", final: 90, semester: "2nd Semester" }, // Slash variant
      { subject: "Physical Education and Health 2", final: 85, semester: "2nd Semester" },
      { subject: "Statistics and Probability", final: 87, semester: "2nd Semester" },
      { subject: "Disaster Readiness and Risk Reduction", final: 92, semester: "2nd Semester" },
      { subject: "Practical Research 1", final: 86, semester: "2nd Semester" },
      { subject: "Basic Calculus", final: 93, semester: "2nd Semester" },
      { subject: "General Chemistry 2", final: 80, semester: "2nd Semester" },
    ];

    const sem1SubjectsSf10 = [
      { subject: "Oral Communication", final: 85, semester: "1st Semester" },
      { subject: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", final: 88, semester: "1st Semester" },
      { subject: "General Mathematics", final: 89, semester: "1st Semester" },
      { subject: "Earth and Life Science", final: 87, semester: "1st Semester" },
      { subject: "21st Century Literature from the Philippines and the World", final: 86, semester: "1st Semester" },
      { subject: "Introduction to the Philosophy of the Human Person", final: 90, semester: "1st Semester" },
      { subject: "Physical Education and Health 1", final: 85, semester: "1st Semester" },
      { subject: "Empowerment Technologies", final: 88, semester: "1st Semester" },
      { subject: "General Chemistry 1", final: 84, semester: "1st Semester" },
    ];

    const sem2SubjectsSf10 = [
      { subject: "Reading and Writing", final: 84, semester: "2nd Semester" },
      { subject: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", final: 80, semester: "2nd Semester" },
      { subject: "Personal Development (Pansariling Kaunlaran)", final: 90, semester: "2nd Semester" }, // Parentheses variant
      { subject: "Physical Education and Health 2", final: 85, semester: "2nd Semester" },
      { subject: "Statistics and Probability", final: 87, semester: "2nd Semester" },
      { subject: "Disaster Readiness and Risk Reduction", final: 92, semester: "2nd Semester" },
      { subject: "Practical Research 1", final: 86, semester: "2nd Semester" },
      { subject: "Basic Calculus", final: 93, semester: "2nd Semester" },
      { subject: "General Chemistry 2", final: 80, semester: "2nd Semester" },
    ];

    const outcome = evaluateUnifiedStudentValidation({
      lrn: "111500619123",
      fullName: "Gomez, Justin Loquillano",
      sf9: {
        raw: {
          school_id: "500169",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "STEM-A",
          shs_semesters: [
            { semester: "1st Semester", subjects: sem1SubjectsSf9 },
            { semester: "2nd Semester", subjects: sem2SubjectsSf9 },
          ],
          first_semester_grades: sem1SubjectsSf9,
          second_semester_grades: sem2SubjectsSf9,
        },
      },
      sf10: {
        raw: {
          lrn: "111500619123",
          last_name: "GOMEZ",
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          school_id: "500169",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "STEM-A",
          shs_semesters: [
            { semester: "1st Semester", subjects: sem1SubjectsSf10 },
            { semester: "2nd Semester", subjects: sem2SubjectsSf10 },
          ],
          first_semester_grades: sem1SubjectsSf10,
          second_semester_grades: sem2SubjectsSf10,
        },
      },
    });

    const subjectRows = outcome.fieldsMatrix.filter((r) => r.category === "ACADEMIC" && r.field !== "general_average");
    assert.equal(subjectRows.length, 18, `Matrix must contain all 18 subjects across Sem 1 and Sem 2, got ${subjectRows.length}`);

    // Verify all 18 subjects have real extracted Final: <grade> in BOTH SF9 and SF10 (NEVER undefined / NO DATA)
    for (const r of subjectRows) {
      assert.ok(r.sf9Value, `${r.label} must have real SF9 value, got ${r.sf9Value}`);
      assert.ok(r.sf10Value, `${r.label} must have real SF10 value, got ${r.sf10Value}`);
      assert.match(String(r.sf9Value), /^Final:\s*\d+$/, `${r.label} SF9 value must be Final: <grade>`);
      assert.match(String(r.sf10Value), /^Final:\s*\d+$/, `${r.label} SF10 value must be Final: <grade>`);
      assert.equal(r.status, "MATCH", `${r.label} must match across SF9 and SF10`);
      assert.equal(r.isMatch, true, `${r.label} isMatch must be true`);
    }

    // Verify Sem 2 subjects are present and matched
    const basicCalcRow = subjectRows.find((r) => r.label?.includes("Basic Calculus"));
    assert.ok(basicCalcRow, "Basic Calculus row must exist in matrix");
    assert.equal(basicCalcRow.sf9Value, "Final: 93");
    assert.equal(basicCalcRow.sf10Value, "Final: 93");

    const persDevRow = subjectRows.find((r) => r.label?.includes("Personal Development"));
    assert.ok(persDevRow, "Personal Development row must exist in matrix");
    assert.equal(persDevRow.sf9Value, "Final: 90");
    assert.equal(persDevRow.sf10Value, "Final: 90");

    const pagbasaRow = subjectRows.find((r) => r.label?.includes("Pagbasa"));
    assert.ok(pagbasaRow, "Pagbasa row must exist in matrix");
    assert.equal(pagbasaRow.sf9Value, "Final: 80");
    assert.equal(pagbasaRow.sf10Value, "Final: 80");

    // 8b. Test reconcileStudentDataFromPrimarySources:
    // When SF9 has authentic Sem 2 grades, reconciles using those EXACT grades (never 88 fallback)
    const dossierWithMismatchedSf10 = {
      lrn: "111500619123",
      fullName: "Gomez, Justin Loquillano",
      overallStatus: "MISMATCH",
      matchedSources: {
        sf9: {
          raw: {
            school_year: "2024-2025",
            grade_level: "Grade 11",
            shs_semesters: [
              { semester: "2nd Semester", subjects: sem2SubjectsSf9 },
            ],
            second_semester_grades: sem2SubjectsSf9,
            general_average: 88, // General average is 88, but must NEVER be used for subject grades!
          },
        },
        sf10: {
          raw: {
            school_year: "2024-2025",
            grade_level: "Grade 11",
            second_semester_grades: [],
          },
        },
      },
      unifiedMatrix: [
        {
          field: "grade_reading_and_writing",
          label: "Subject: Reading and Writing",
          category: "ACADEMIC",
          sf9Value: "Final: 84",
          sf10Value: undefined,
          status: "INCOMPLETE",
          isMatch: false,
        },
        {
          field: "grade_basic_calculus",
          label: "Subject: Basic Calculus",
          category: "ACADEMIC",
          sf9Value: "Final: 93",
          sf10Value: "Final: 75",
          status: "MISMATCH",
          isMatch: false,
        },
        {
          field: "grade_disaster_readiness",
          label: "Subject: Disaster Readiness and Risk Reduction",
          category: "ACADEMIC",
          sf9Value: "Final: 92",
          sf10Value: undefined,
          status: "INCOMPLETE",
          isMatch: false,
        },
        {
          field: "grade_unextracted_subject",
          label: "Subject: Robotics",
          category: "ACADEMIC",
          sf9Value: undefined, // SF9 has NO grade for this subject
          sf10Value: undefined,
          status: "INCOMPLETE",
          isMatch: false,
        },
      ],
      discrepancies: [
        { id: "disc-1", field: "grade_reading_and_writing", severity: "CRITICAL" },
        { id: "disc-2", field: "grade_basic_calculus", severity: "CRITICAL" },
        { id: "disc-3", field: "grade_disaster_readiness", severity: "CRITICAL" },
        { id: "disc-4", field: "grade_unextracted_subject", severity: "CRITICAL" },
      ],
    };

    const recResult = reconcileStudentDataFromPrimarySources(dossierWithMismatchedSf10);

    // Reading and Writing must be reconciled to 84 (exact SF9 grade, NOT 88)
    const recRw = recResult.unifiedMatrix.find((r) => r.field === "grade_reading_and_writing");
    assert.equal(recRw.sf10Value, "Final: 84", "Reading and Writing SF10 must be reconciled to 84, never 88");
    assert.equal(recRw.status, "MATCH");

    // Basic Calculus must be reconciled to 93 (exact SF9 grade, NOT 88)
    const recBc = recResult.unifiedMatrix.find((r) => r.field === "grade_basic_calculus");
    assert.equal(recBc.sf10Value, "Final: 93", "Basic Calculus SF10 must be reconciled to 93, never 88");
    assert.equal(recBc.status, "MATCH");

    // Disaster Readiness must be reconciled to 92 (exact SF9 grade, NOT 88)
    const recDrrr = recResult.unifiedMatrix.find((r) => r.field === "grade_disaster_readiness");
    assert.equal(recDrrr.sf10Value, "Final: 92", "Disaster Readiness SF10 must be reconciled to 92, never 88");
    assert.equal(recDrrr.status, "MATCH");

    // Unextracted Subject (NO grade on SF9): MUST REMAIN UNTOUCHED (NEVER fabricated 88!)
    const recUnextracted = recResult.unifiedMatrix.find((r) => r.field === "grade_unextracted_subject");
    assert.equal(recUnextracted.sf9Value, undefined, "Unextracted subject SF9 must remain undefined");
    assert.equal(recUnextracted.sf10Value, undefined, "Unextracted subject SF10 must remain undefined (NEVER 88)");
    assert.equal(recUnextracted.status, "INCOMPLETE", "Unextracted subject must remain INCOMPLETE");
    assert.equal(recUnextracted.isMatch, false, "Unextracted subject isMatch must remain false");

    // Reconciliation log must show exact grades, NEVER fabricated 88
    const rwLog = recResult.reconciliationLog.find((l) => l.fieldName.includes("Reading and Writing"));
    assert.ok(rwLog, "Must log Reading and Writing reconciliation");
    assert.equal(rwLog.baselineValue, "84", "Must log baselineValue as authentic 84, never 88");

    const bcLog = recResult.reconciliationLog.find((l) => l.fieldName.includes("Basic Calculus"));
    assert.ok(bcLog, "Must log Basic Calculus reconciliation");
    assert.equal(bcLog.baselineValue, "93", "Must log baselineValue as authentic 93, never 88");

    // Ensure NO log item was created for the unextracted subject
    const unextractedLog = recResult.reconciliationLog.find((l) => l.fieldName.includes("Robotics"));
    assert.equal(unextractedLog, undefined, "Must NOT log or reconcile subject with NO SF9 grade");
  });

  // ---------------------------------------------------------------------------
  // 10. Grade Level Normalization, PSA Civil Document (N/A), & Circular JSON Prevention
  // ---------------------------------------------------------------------------
  await t.test("10. Grade Level Normalization ('Grade 11' === '11'), PSA 'Civil Document (N/A)', Single-Source School ID & Acyclic Dossier", async (t) => {
    // 10a. normalizeGradeLevelForComparison helper
    assert.equal(normalizeGradeLevelForComparison("Grade 11"), "11");
    assert.equal(normalizeGradeLevelForComparison("11"), "11");
    assert.equal(normalizeGradeLevelForComparison("G11"), "11");
    assert.equal(normalizeGradeLevelForComparison("GRADE 11"), "11");
    assert.equal(normalizeGradeLevelForComparison("Gr. 11"), "11");
    assert.equal(normalizeGradeLevelForComparison("Grade 12"), "12");
    assert.equal(normalizeGradeLevelForComparison("12"), "12");
    assert.equal(normalizeGradeLevelForComparison("G12"), "12");
    assert.equal(normalizeGradeLevelForComparison("grade 12"), "12");

    // 10b. evaluateUnifiedStudentValidation with Grade Level ("Grade 11", "Grade 11", "11", "Grade 11")
    // and DepEd School ID present only on SF10 (500619) while others are blank
    const validationOutcome = evaluateUnifiedStudentValidation({
      lrn: "111500619123",
      fullName: "Gomez, Justin Loquillano",
      psa: {
        raw: {
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          last_name: "GOMEZ",
          birth_date: "2004-06-23",
          sex: "Male",
        },
      },
      sf1: {
        raw: {
          lrn: "111500619123",
          last_name: "GOMEZ",
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          grade_level: "Grade 11",
          school_year: "2025-2026",
          section: "CSS 1",
          track_strand: "TVL - CSS",
        },
      },
      sf2Records: [
        {
          raw: {
            lrn: "111500619123",
            last_name: "GOMEZ",
            first_name: "JUSTIN",
            middle_name: "LOQUILLANO",
            grade_level: "Grade 11",
            school_year: "2025-2026",
            section: "CSS 1",
          },
        },
      ],
      sf9: {
        raw: {
          lrn: "111500619123",
          last_name: "GOMEZ",
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          grade_level: "11", // SF9 has bare number "11"
          school_year: "2025-2026",
          section: "CSS 1",
          track_strand: "TVL - CSS",
        },
      },
      sf10: {
        raw: {
          lrn: "111500619123",
          last_name: "GOMEZ",
          first_name: "JUSTIN",
          middle_name: "LOQUILLANO",
          school_id: "500619", // Only SF10 has School ID
          grade_level: "Grade 11",
          school_year: "2019-2020", // Historical SF10 year
          section: "Rizal", // Historical SF10 section
          track_strand: "Academic - STEM",
        },
      },
    });

    // Grade Level row must evaluate to MATCH across "Grade 11", "Grade 11", "11", "Grade 11"
    const gradeRow = validationOutcome.fieldsMatrix.find((r) => r.field === "grade_level");
    assert.ok(gradeRow, "Grade level row must exist in matrix");
    assert.equal(gradeRow.status, "MATCH", "Grade Level row must evaluate to MATCH");
    assert.equal(gradeRow.isMatch, true);
    assert.equal(gradeRow.psaValue, "Civil Document (N/A)", "PSA must be labeled Civil Document (N/A) for grade_level");

    // DepEd School ID row: only on SF10 (500619), others undefined -> evaluates to MATCH without conflict
    const schoolIdRow = validationOutcome.fieldsMatrix.find((r) => r.field === "school_id");
    assert.ok(schoolIdRow, "School ID row must exist in matrix");
    assert.equal(schoolIdRow.status, "MATCH", "Single authentic DepEd School ID must evaluate to MATCH");
    assert.equal(schoolIdRow.isMatch, true);
    assert.equal(schoolIdRow.sf10Value, "500619");
    assert.equal(schoolIdRow.psaValue, "Civil Document (N/A)", "PSA must be labeled Civil Document (N/A) for school_id");

    // PSA value must be "Civil Document (N/A)" for all DepEd-only rows
    const syRow = validationOutcome.fieldsMatrix.find((r) => r.field === "school_year");
    assert.equal(syRow?.psaValue, "Civil Document (N/A)");

    const secRow = validationOutcome.fieldsMatrix.find((r) => r.field === "section");
    assert.equal(secRow?.psaValue, "Civil Document (N/A)");

    const strandRow = validationOutcome.fieldsMatrix.find((r) => r.field === "track_strand");
    assert.equal(strandRow?.psaValue, "Civil Document (N/A)");

    // 10c. Reconcile primary sources and verify acyclic JSON serialization
    const dossierToReconcile = {
      lrn: "111500619123",
      fullName: "Gomez, Justin Loquillano",
      overallStatus: validationOutcome.overallStatus,
      matchedSources: {
        psa: { raw: { first_name: "JUSTIN", middle_name: "LOQUILLANO", last_name: "GOMEZ" } },
        sf1: {
          raw: {
            school_year: "2025-2026",
            section: "CSS 1",
            grade_level: "Grade 11",
            track_strand: "TVL - CSS",
          },
        },
        sf2: {
          raw: {
            school_year: "2025-2026",
            section: "CSS 1",
          },
        },
        sf9: {
          raw: {
            school_year: "2025-2026",
            section: "CSS 1",
            grade_level: "11",
            track_strand: "TVL - CSS",
          },
        },
        sf10: {
          raw: {
            school_id: "500619",
            school_year: "2019-2020",
            section: "Rizal",
            grade_level: "Grade 11",
            track_strand: "Academic - STEM",
          },
        },
      },
      unifiedMatrix: validationOutcome.fieldsMatrix,
      discrepancies: validationOutcome.discrepancies,
    };

    const reconciled = reconcileStudentDataFromPrimarySources(dossierToReconcile);

    // Assert that native JSON.stringify does NOT throw circular structure error!
    assert.doesNotThrow(() => {
      JSON.stringify(reconciled);
    }, "JSON.stringify(reconciled) must NOT throw circular reference error");

    // Assert that safeJsonStringify wraps the batch upload payload with ZERO circular errors
    const batchUploadPayload = {
      action: "classify_and_validate",
      batchId: "batch-test-10",
      commitToRegistry: true,
      reconciledDossier: reconciled,
    };

    let serializedPayload = "";
    assert.doesNotThrow(() => {
      serializedPayload = safeJsonStringify(batchUploadPayload);
    }, "safeJsonStringify(batchUploadPayload) must succeed without throwing");
    assert.ok(serializedPayload.includes('"batchId":"batch-test-10"'));
    assert.ok(serializedPayload.includes('"reconciledDossier"'));

    // Assert reconciled fields: School Year reconciled to current 2025-2026, Section reconciled to CSS 1
    const recSy = reconciled.unifiedMatrix.find((r) => r.field === "school_year");
    assert.equal(recSy?.status, "MATCH");
    assert.equal(recSy?.sf10Value, "2025-2026");

    const recSec = reconciled.unifiedMatrix.find((r) => r.field === "section");
    assert.equal(recSec?.status, "MATCH");
    assert.equal(recSec?.sf10Value, "CSS 1");
  });
});

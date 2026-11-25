import test from "node:test";
import assert from "node:assert/strict";

import { parseShsSf1, extractShsSf1Header, splitLearnerName } from "../src/lib/ocr/shsSf1Parser.ts";
import { parseShsSf2, extractShsSf2Header } from "../src/lib/ocr/shsSf2Parser.ts";
import { parseShsSf5, extractShsSf5Header } from "../src/lib/ocr/shsSf5Parser.ts";
import { parsePsaBirthCert } from "../src/lib/ocr/psaParser.ts";
import { classifyDocument } from "../src/lib/validation/documentClassifier.ts";

test("SHS Specialized Parsers & Extraction Schemas Suite", async (t) => {
  await t.test("1. SHS SF1 Parser (School Register)", () => {
    const sampleSf1Text = `
      Republic of the Philippines
      Department of Education
      School Form 1 (SF1) School Register
      For Senior High School

      School Name: Taysan Resettlement Integrated School
      School ID: 500169
      District: Legazpi City
      Division: Legazpi City
      Region: Region V
      Semester: 1st Semester
      School Year: 2026-2027
      Grade Level: Grade 11
      Section: Rizal
      Track: Academic Track
      Strand: Science, Technology, Engineering, and Mathematics (STEM)

      MALE
      109345000001 | Dela Cruz, Juan Miguel Jr. | M | 2009-06-15 | 17 | Roman Catholic | Purok 3, Taysan, Legazpi City | Pedro Dela Cruz | Maria Santos
      109345000002 | Santos, Jose Antonio | M | 2009-08-20 | 17 | Christian | San Roque, Legazpi City | Antonio Santos | Elena Ramos

      FEMALE
      109345000003 | Reyes, Maria Clara | F | 2009-04-10 | 17 | Roman Catholic | Taysan Resettlement | Carlos Reyes | Teresa Diaz
    `;

    const res = parseShsSf1(sampleSf1Text);

    // Verify header
    assert.equal(res.header.school_id, "500169");
    assert.equal(res.header.school_name, "Taysan Resettlement Integrated School");
    assert.equal(res.header.grade_level, "Grade 11");
    assert.equal(res.header.section, "Rizal");
    assert.equal(res.header.track, "Academic Track");
    assert.ok(res.header.strand?.includes("STEM"));
    assert.equal(res.header.semester, "1st Semester");
    assert.equal(res.header.school_year, "2026-2027");

    // Verify learners
    assert.equal(res.learners.length, 3);
    assert.equal(res.total_male_count, 2);
    assert.equal(res.total_female_count, 1);
    assert.equal(res.total_enrolled_count, 3);

    // Check learner 1 details
    const l1 = res.learners[0];
    assert.equal(l1.lrn, "109345000001");
    assert.equal(l1.last_name, "Dela Cruz");
    assert.equal(l1.first_name, "Juan");
    assert.equal(l1.suffix, "JR.");
    assert.equal(l1.sex, "M");
    assert.equal(l1.grade_level, "Grade 11");
    assert.equal(l1.section, "Rizal");

    // Check learner 3 (female)
    const l3 = res.learners[2];
    assert.equal(l3.lrn, "109345000003");
    assert.equal(l3.last_name, "Reyes");
    assert.equal(l3.sex, "F");
  });

  await t.test("2. SHS SF2 Parser (Daily Attendance Report)", () => {
    const sampleSf2Text = `
      Republic of the Philippines - Department of Education
      School Form 2 (SF2) Daily Attendance Report of Learners
      Senior High School

      School Name: Taysan Resettlement Integrated School
      School ID: 500169
      School Year: 2026-2027
      Grade Level: Grade 11
      Section: Rizal
      For the month of: September
      Total School Days: 22

      Learner's Name (Last Name, First Name, Middle Name)
      Dela Cruz, Juan Miguel 21 1 0
      Santos, Jose Antonio 22 0 0
      Reyes, Maria Clara 16 6 1
    `;

    const res = parseShsSf2(sampleSf2Text);

    // Verify header
    assert.equal(res.header.school_id, "500169");
    assert.equal(res.header.grade_level, "Grade 11");
    assert.equal(res.header.section, "Rizal");
    assert.equal(res.header.month, "September");
    assert.equal(res.header.total_school_days, 22);

    // Verify attendance rows
    assert.equal(res.attendance.length, 3);
    assert.equal(res.attendance[0].learner_name, "Dela Cruz, Juan Miguel");
    assert.equal(res.attendance[0].days_present, 21);
    assert.equal(res.attendance[0].days_absent, 1);
    assert.equal(res.attendance[0].days_tardy, 0);

    // Third learner has 6 absences -> risk alert
    assert.equal(res.attendance[2].days_absent, 6);
    assert.equal(res.summary_metrics.learners_at_risk_absent_5_days, 1);
  });

  await t.test("3. SHS SF5 Parser: SF5A-SHS End of Semester Status", () => {
    const sampleSf5AText = `
      School Form 5A (SF5A-SHS)
      End of Semester and School Year Learner Status
      School ID: 500169
      School Year: 2026-2027
      Grade Level: Grade 11
      Section: Rizal
      Semester: 1st Semester
      Track: Academic Track
      Strand: STEM

      LRN | Learner Name | General Average | Action Taken
      109345000001 Dela Cruz, Juan Miguel 91.5 COMPLETE
      109345000002 Santos, Jose Antonio 86.0 COMPLETE
      109345000003 Reyes, Maria Clara 72.5 INCOMPLETE
    `;

    const res = parseShsSf5(sampleSf5AText);

    assert.equal(res.header.form_variant, "SF5A-SHS");
    assert.equal(res.header.school_id, "500169");
    assert.equal(res.header.grade_level, "Grade 11");
    assert.equal(res.header.semester, "1st Semester");

    assert.equal(res.learners.length, 3);
    assert.equal(res.total_complete, 2);
    assert.equal(res.total_incomplete, 1);

    // Learner 1: 91.5 -> Outstanding
    assert.equal(res.learners[0].general_average, 91.5);
    assert.equal(res.learners[0].action_taken, "COMPLETE");
    assert.equal(res.learners[0].proficiency_level, "OUTSTANDING");

    // Learner 3: 72.5 -> Did Not Meet Expectations / INCOMPLETE
    assert.equal(res.learners[2].general_average, 72.5);
    assert.equal(res.learners[2].action_taken, "INCOMPLETE");
    assert.equal(res.learners[2].proficiency_level, "DID_NOT_MEET_EXPECTATIONS");
  });

  await t.test("4. SHS SF5 Parser: SF5B-SHS Graduation Candidates", () => {
    const sampleSf5BText = `
      School Form 5B (SF5B-SHS)
      List of Candidates for Complete SHS Program / Graduation
      School ID: 500169
      School Year: 2026-2027
      Grade Level: Grade 12
      Section: Bonifacio

      LRN | Learner Name | General Average | Program Completion Status
      109345000010 Bonifacio, Andres 95.0 GRADUATING
      109345000011 Jacinto, Emilio 74.0 PENDING_DEFICIENCIES
    `;

    const res = parseShsSf5(sampleSf5BText);

    assert.equal(res.header.form_variant, "SF5B-SHS");
    assert.equal(res.header.grade_level, "Grade 12");
    assert.equal(res.learners.length, 2);
    assert.equal(res.learners[0].action_taken, "GRADUATING");
    assert.equal(res.learners[0].proficiency_level, "OUTSTANDING");
    assert.equal(res.learners[1].action_taken, "PENDING_DEFICIENCIES");
  });

  await t.test("5. PSA Birth Certificate Parser (Supporting Civil Document)", () => {
    const samplePsaText = `
      Republic of the Philippines
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      Registry No. 2009-450912

      NAME OF CHILD: JUAN MIGUEL DELA CRUZ JR.
      SEX: Male
      DATE OF BIRTH: 15 June 2009
      PLACE OF BIRTH: Bicol Regional Hospital, Legazpi City, Albay
      MOTHER'S MAIDEN NAME: MARIA CLARA SANTOS
      CITIZENSHIP: Filipino
      FATHER'S NAME: PEDRO DELA CRUZ
      CITIZENSHIP: Filipino
    `;

    const res = parsePsaBirthCert(samplePsaText);

    assert.equal(res.identity.registry_number, "2009-450912");
    assert.equal(res.identity.first_name, "Juan");
    assert.equal(res.identity.last_name, "Dela Cruz");
    assert.equal(res.identity.sex, "M");
    assert.equal(res.identity.birth_date, "2009-06-15");
    assert.match(res.identity.mother_maiden_name, /MARIA CLARA SANTOS/i);
    assert.match(res.identity.father_name, /PEDRO DELA CRUZ/i);
  });

  await t.test("6. Document Classifier: Multi-Document Classification", () => {
    // SF1 text
    const sf1Cls = classifyDocument("Department of Education School Form 1 (SF1) School Register registered learners");
    assert.equal(sf1Cls.detectedType, "sf1");
    assert.equal(sf1Cls.isPlausible, true);

    // SF2 text
    const sf2Cls = classifyDocument("School Form 2 (SF2) Daily Attendance Report for the month of September");
    assert.equal(sf2Cls.detectedType, "sf2");
    assert.equal(sf2Cls.isPlausible, true);

    // SF5 text
    const sf5Cls = classifyDocument("School Form 5 (SF5A-SHS) Report on Promotion and Learner Status end of semester");
    assert.equal(sf5Cls.detectedType, "sf5");
    assert.equal(sf5Cls.isPlausible, true);

    // PSA text
    const psaCls = classifyDocument("Certificate of Live Birth Philippine Statistics Authority Registry No child mother father");
    assert.equal(psaCls.detectedType, "birth_cert");
    assert.equal(psaCls.isPlausible, true);

    // Unrelated document
    const photoCls = classifyDocument("Selfie at the beach with friends having dinner and ice cream sunset");
    assert.equal(photoCls.detectedType, "unrelated_document");
    assert.equal(photoCls.isPlausible, false);
  });
});

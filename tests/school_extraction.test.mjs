import test from "node:test";
import assert from "node:assert/strict";
import { parseOcrText } from "../src/lib/ocr/parser.ts";
import {
  extractSchoolFromText,
  cleanSchoolName,
  isValidSchoolCandidate,
  extractSpatialIdentity,
} from "../src/lib/ocr/spatialIdentityParser.ts";
import { validateFields } from "../src/lib/validation/engine.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";
import { MistralOcrProvider } from "../src/lib/ocr/providers/mistralProvider.ts";

const REAL_SF9_SHS_FRONT_TEXT = `=== FRONT (IDENTITY) ===
REPORT ON ATTENDANCE
Jun Jul Aug Sept Oct Nov Dec Jan Feb Mar Apr Total
No. of School Days 20 22 22 20 22 20 15 21 20 22 18 222
No. of Days Present 19 21 22 19 21 20 14 20 19 21 18 214
No. of Days Absent 110110111108
PARENT / GUARDIAN'S SIGNATURE
1 st Quarter
2nd Quarter
3rd Quarter
4th Quarter
Certificate of Transfer
Admitted to Grade:
Section:
Eligibility for Admission to Grade:
Approved: School Head
Adviser
Cancellation of Eligibility to Transfer
Admitted in:
Date:
School Head
SF9-SHS
LRN: 111687140043
Republic of the Philippines DEPARTMENT OF EDUCATION I Region
DIVISION OF XXXXXXX Division DEPED TAMBAYAN NATIONAL HIGH SCHOOL School
Name : GOMEZ, JUSTIN LOQUILLAND
Last Name: GOMEZ
First Name: JUSTIN
Middle Name: LOQUILLAND
Age : 16
Sex: Male
Grade : 11
Section: Rizal
Curriculum: K to 12 Basic Education Curriculum
School Year: 2019-2020
Track/ Strand: Academic/ Science, Technology, Engineering, Mathematics (STEM)
Dear Parent/Guardian,
This report card shows the ability and progress your child has made in the different learning areas as well as his/her core values.
The school welcomes you should you desire to know more about your child's progress.
RICHARD R. RAQUEÑO
Adviser
Mr. Leizel Moral Villa
Principal IV
`;

test("Condition 1: School name directly above School label is extracted correctly", () => {
  const twoLine = `Republic of the Philippines\nDEPARTMENT OF EDUCATION\nRegion V\nDivision of Albay\nTAMBAYAN NATIONAL HIGH SCHOOL\nSchool\nName: GOMEZ, JUSTIN LOQUILLAND`;
  const res = extractSchoolFromText(twoLine);
  assert.equal(res.schoolName, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(res.hasSchoolLabel, true);

  // Also test concatenated multi-column line
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
});

test("Condition 2: Department of Education must NOT become school name", () => {
  assert.equal(isValidSchoolCandidate("DEPARTMENT OF EDUCATION"), false);
  assert.equal(isValidSchoolCandidate("Department of Education"), false);
  assert.equal(isValidSchoolCandidate("Kagawaran ng Edukasyon"), false);

  const textWithDepEdOnly = `Republic of the Philippines\nDEPARTMENT OF EDUCATION\nSchool\nName: Dela Cruz, Juan`;
  const res = extractSchoolFromText(textWithDepEdOnly);
  assert.notEqual(res.schoolName, "DEPARTMENT OF EDUCATION");
  assert.equal(res.schoolName, "");
});

test("Condition 3: Division name must NOT become school name", () => {
  assert.equal(isValidSchoolCandidate("Division of Albay"), false);
  assert.equal(isValidSchoolCandidate("DIVISION OF XXXXXXX"), false);
  assert.equal(isValidSchoolCandidate("Division"), false);

  const textWithDivOnly = `DIVISION OF ALBAY\nDivision\nSchool\nName: Dela Cruz, Juan`;
  const res = extractSchoolFromText(textWithDivOnly);
  assert.notEqual(res.schoolName, "DIVISION OF ALBAY");
  assert.notEqual(res.schoolName, "Division");
  assert.equal(res.schoolName, "");
});

test("Condition 4: Region must NOT become school name", () => {
  assert.equal(isValidSchoolCandidate("Region I"), false);
  assert.equal(isValidSchoolCandidate("Region V"), false);
  assert.equal(isValidSchoolCandidate("Rehiyon V"), false);
  assert.equal(isValidSchoolCandidate("Region"), false);

  const textWithRegOnly = `Region V\nRegion\nSchool\nName: Dela Cruz, Juan`;
  const res = extractSchoolFromText(textWithRegOnly);
  assert.notEqual(res.schoolName, "Region V");
  assert.equal(res.schoolName, "");
});

test("Condition 5: Learner name must NOT become school name", () => {
  const learner = "GOMEZ, JUSTIN LOQUILLAND";
  assert.equal(
    isValidSchoolCandidate("GOMEZ, JUSTIN LOQUILLAND", {
      learnerName: learner,
      learnerFirstName: "JUSTIN",
      learnerLastName: "GOMEZ",
    }),
    false
  );
  assert.equal(
    isValidSchoolCandidate("JUSTIN GOMEZ", {
      learnerName: learner,
      learnerFirstName: "JUSTIN",
      learnerLastName: "GOMEZ",
    }),
    false
  );

  const textWithStudentAboveSchool = `GOMEZ, JUSTIN LOQUILLAND\nSchool`;
  const res = extractSchoolFromText(textWithStudentAboveSchool, {
    learnerName: learner,
    learnerFirstName: "JUSTIN",
    learnerLastName: "GOMEZ",
  });
  assert.notEqual(res.schoolName, learner);
  assert.equal(res.schoolName, "");
});

test("Condition 6: Inline School: <name> still works where supported", () => {
  const inline1 = "School Name: Legazpi City National High School\nLRN: 111687140043";
  const parsed1 = parseOcrText(inline1);
  assert.equal(parsed1.school_name, "Legazpi City National High School");

  const inline2 = "School: Taysan Resettlement Integrated School\nGrade: 11";
  const parsed2 = parseOcrText(inline2);
  assert.equal(parsed2.school_name, "Taysan Resettlement Integrated School");

  const inline3 = "Paaralan: Mabini Elementary School\nBaitang: 6";
  const parsed3 = parseOcrText(inline3);
  assert.equal(parsed3.school_name, "Mabini Elementary School");
});

test("Condition 7: School label present but unreadable value triggers Needs Verification, not false missing failure", () => {
  const unextracted = {
    name: "Dela Cruz, Juan",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2023-2024",
    school_name: "",
    school_name_unextracted: true,
    flags: ["school_name_unextracted"],
    adviser: "RICHARD R. RAQUEÑO",
  };

  const val = validateFields(unextracted);
  const schoolRule = val.results.find((r) => r.fieldName === "school_name" && r.ruleName === "school_present");
  assert.ok(schoolRule);
  assert.equal(schoolRule.passed, false);
  assert.equal(schoolRule.severity, "warning");
  assert.equal(
    schoolRule.message,
    "School name could not be reliably extracted. Verify against the original SF9."
  );
  // Status must be needs_review ("Needs Verification"), NOT invalid
  assert.equal(val.status, "needs_review");
});

test("Condition 8: Truly blank verified school field fails with standard missing-school message", () => {
  const genuinelyBlank = {
    name: "Dela Cruz, Juan",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2023-2024",
    school_name: "",
    school_name_unextracted: false,
    flags: ["missing_school_name"],
    adviser: "RICHARD R. RAQUEÑO",
  };

  const val = validateFields(genuinelyBlank);
  const schoolRule = val.results.find((r) => r.fieldName === "school_name" && r.ruleName === "school_present");
  assert.ok(schoolRule);
  assert.equal(schoolRule.passed, false);
  assert.equal(schoolRule.severity, "error");
  assert.equal(schoolRule.message, "School name must be present.");
  // Document status becomes invalid because severity is error
  assert.equal(val.status, "invalid");
});

test("Condition 9: Adviser extraction remains correct", () => {
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.adviser, "RICHARD R. RAQUEÑO");
  assert.equal(parsed.adviser_unextracted, false);
});

test("Condition 10: Learner identity extraction remains intact", () => {
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.lrn, "111687140043");
  assert.equal(parsed.grade_level, "11");
  assert.equal(parsed.school_year, "2019-2020");
  assert.equal(parsed.section, "Rizal");
  assert.equal(parsed.sex, "M");
  assert.equal(parsed.age, "16");
});

test("Condition 11: SHS grade extraction remains unchanged", () => {
  const shsBackText = `=== BACK (GRADES) ===
First Semester
| Subjects | Quarter 1 | Quarter 2 | Semester Final Grade |
Core Subjects
| Oral Communication | 90 | 80 | 85 |
| General Mathematics | 95 | 96 | 96 |
Applied and Specialized Subjects
| Empowerment Technologies | 88 | 87 | 88 |
Second Semester
| Subjects | Quarter 3 | Quarter 4 | Semester Final Grade |
Core Subjects
| Reading and Writing | 82 | 82 | 82 |
Applied and Specialized Subjects
| Practical Research 1 | 85 | 89 | 87 |
`;
  const parsed = parseSeniorHighGradesText(shsBackText);
  assert.ok(Array.isArray(parsed.grades));
  assert.ok(parsed.grades.length >= 4);

  const oralComm = parsed.grades.find((g) => g.subject.includes("Oral Communication"));
  assert.ok(oralComm);
  assert.equal(oralComm.q1, 90);
  assert.equal(oralComm.q2, 80);
  assert.equal(oralComm.semester, "1st Semester");
});

test("Condition 12: Azure -> Mistral provider priority hierarchy remains intact", () => {
  const orchestrator = new OcrOrchestrator();
  assert.ok(orchestrator);
  assert.equal(orchestrator.getPrimaryProvider().name, "azure");
  assert.equal(orchestrator.getFallbackProvider()?.name, "mistral");

  const azure = new AzureDocumentIntelligenceProvider();
  assert.equal(azure.name, "azure");

  const mistral = new MistralOcrProvider();
  assert.equal(mistral.name, "mistral");
});

test("Condition 13 (Bonus): Spatial layout school extraction anchors directly to School geometry", () => {
  // Mock layout geometry representing DepEd SF9 upper identity header
  const mockLayout = {
    pages: [
      {
        pageNumber: 1,
        width: 1000,
        height: 1000,
        lines: [
          // Division label
          {
            content: "Division",
            polygon: [700, 220, 800, 220, 800, 240, 700, 240],
          },
          // School name directly above School label
          {
            content: "DEPED TAMBAYAN NATIONAL HIGH SCHOOL",
            polygon: [600, 250, 900, 250, 900, 270, 600, 270],
          },
          // School label anchor
          {
            content: "School",
            polygon: [720, 275, 780, 275, 780, 295, 720, 295],
          },
        ],
        words: [
          {
            content: "School",
            polygon: [720, 275, 780, 275, 780, 295, 720, 295],
            confidence: 0.99,
          },
        ],
      },
    ],
  };

  const spatialResult = extractSpatialIdentity(mockLayout);
  assert.equal(spatialResult.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
});

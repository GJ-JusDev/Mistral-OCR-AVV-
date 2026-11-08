import test from "node:test";
import assert from "node:assert/strict";
import { parseOcrText } from "../src/lib/ocr/parser.ts";
import {
  extractAdviserFromText,
  cleanAdviserName,
  isValidAdviserCandidate,
  extractSpatialIdentity,
} from "../src/lib/ocr/spatialIdentityParser.ts";
import { validateFields } from "../src/lib/validation/engine.ts";
import { VALIDATION_RULES } from "../src/lib/validation/rules.ts";
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

test("Condition 1: Printed adviser name directly above Adviser label is cleanly extracted", () => {
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.adviser, "RICHARD R. RAQUEÑO");
  assert.equal(parsed.adviser_unextracted, false);
});

test("Condition 2: Principal / School Head name is NEVER captured as adviser", () => {
  const textWithPrincipal = `
Dear Parent/Guardian,
The school welcomes you should you desire to know more about your child's progress.
Adviser
Mr. Leizel Moral Villa
Principal IV
`;
  const res = extractAdviserFromText(textWithPrincipal);
  assert.notEqual(res.adviser, "Mr. Leizel Moral Villa");
  assert.notEqual(res.adviser, "Principal IV");
  assert.equal(res.adviser, "");
  assert.equal(res.hasAdviserLabel, true);

  // Directly check candidate validator
  assert.equal(isValidAdviserCandidate("Mr. Leizel Moral Villa Principal IV"), false);
  assert.equal(isValidAdviserCandidate("School Head"), false);
  assert.equal(isValidAdviserCandidate("Principal IV"), false);
});

test("Condition 3: Learner name is NEVER captured as adviser", () => {
  const textWithStudentName = `
Name: GOMEZ, JUSTIN LOQUILLAND
JUSTIN LOQUILLAND GOMEZ
Adviser
`;
  const res = extractAdviserFromText(textWithStudentName, {
    learnerName: "GOMEZ, JUSTIN LOQUILLAND",
    learnerFirstName: "JUSTIN",
    learnerLastName: "GOMEZ",
  });
  assert.equal(res.adviser, "");
  assert.equal(res.hasAdviserLabel, true);

  // Directly check candidate validator
  assert.equal(
    isValidAdviserCandidate("GOMEZ, JUSTIN LOQUILLAND", {
      learnerName: "GOMEZ, JUSTIN LOQUILLAND",
      learnerLastName: "GOMEZ",
      learnerFirstName: "JUSTIN",
    }),
    false
  );
  assert.equal(
    isValidAdviserCandidate("JUSTIN GOMEZ", {
      learnerName: "GOMEZ, JUSTIN LOQUILLAND",
      learnerLastName: "GOMEZ",
      learnerFirstName: "JUSTIN",
    }),
    false
  );
});

test("Condition 4: Same-line adviser format is successfully extracted", () => {
  const sameLine1 = "Class Adviser: Maria C. Santos\nSchool: Legazpi High";
  const parsed1 = parseOcrText(sameLine1);
  assert.equal(parsed1.adviser, "Maria C. Santos");

  const sameLine2 = "Adviser - JUAN DELA CRUZ\nGrade: 11";
  const parsed2 = parseOcrText(sameLine2);
  assert.equal(parsed2.adviser, "JUAN DELA CRUZ");

  const sameLine3 = "Guro: Bb. Teresa Magbanua\nSection: Rizal";
  const parsed3 = parseOcrText(sameLine3);
  assert.equal(parsed3.adviser, "Bb. Teresa Magbanua");
});

test("Condition 5: Adviser label present with unreadable name triggers warning / Needs Verification", () => {
  const unextractedText = `
LRN: 111687140043
Name: Dela Cruz, Juan
Grade: 11
School Year: 2023-2024
School: Legazpi National High School
Dear Parent/Guardian,
Adviser
Principal IV
`;
  const parsed = parseOcrText(unextractedText);
  assert.equal(parsed.adviser, "");
  assert.equal(parsed.adviser_unextracted, true);
  assert.ok(parsed.flags?.includes("adviser_unextracted"));

  const val = validateFields(parsed);
  const adviserResult = val.results.find((r) => r.fieldName === "adviser");
  assert.ok(adviserResult);
  assert.equal(adviserResult.passed, false);
  assert.equal(adviserResult.severity, "warning");
  assert.equal(
    adviserResult.message,
    "Adviser name could not be reliably extracted. Verify against the original SF9."
  );
  // Status should be needs_review, NOT invalid
  assert.equal(val.status, "needs_review");
});

test("Condition 6: Truly blank / missing adviser field fails with standard recording message", () => {
  const genuinelyBlank = {
    name: "Dela Cruz, Juan",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2023-2024",
    school_name: "Legazpi National High School",
    adviser: "",
    adviser_unextracted: false,
    flags: [],
  };

  const val = validateFields(genuinelyBlank);
  const adviserResult = val.results.find((r) => r.fieldName === "adviser");
  assert.ok(adviserResult);
  assert.equal(adviserResult.passed, false);
  assert.equal(adviserResult.severity, "warning");
  assert.equal(adviserResult.message, "Class adviser name should be recorded.");
});

test("Condition 7: Learner identity extraction remains intact", () => {
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.lrn, "111687140043");
  assert.equal(parsed.grade_level, "11");
  assert.equal(parsed.school_year, "2019-2020");
  assert.equal(parsed.section, "Rizal");
  assert.equal(parsed.sex, "M");
  assert.equal(parsed.age, "16");
  assert.equal(parsed.adviser, "RICHARD R. RAQUEÑO");

  // Validate that with extracted adviser, adviser rule passes
  const val = validateFields(parsed);
  const adviserRule = val.results.find((r) => r.fieldName === "adviser");
  assert.equal(adviserRule?.passed, true);
});

test("Condition 8: Senior High School grade extraction remains intact", () => {
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

  const readingWriting = parsed.grades.find((g) => g.subject.includes("Reading and Writing"));
  assert.ok(readingWriting);
  assert.equal(readingWriting.q3, 82);
  assert.equal(readingWriting.q4, 82);
  assert.equal(readingWriting.semester, "2nd Semester");
});

test("Condition 9: Provider priority hierarchy is preserved (Azure -> Mistral)", async () => {
  const orchestrator = new OcrOrchestrator();
  assert.ok(orchestrator);
  assert.equal(orchestrator.getPrimaryProvider().name, "azure");
  assert.equal(orchestrator.getFallbackProvider()?.name, "mistral");

  const azure = new AzureDocumentIntelligenceProvider();
  assert.equal(azure.name, "azure");

  const mistral = new MistralOcrProvider();
  assert.equal(mistral.name, "mistral");
});

test("Condition 10: Spatial layout adviser extraction anchors directly to Adviser geometry", () => {
  // Mock layout geometry representing DepEd SF9 bottom-right signature quadrant
  const mockLayout = {
    pages: [
      {
        pageNumber: 1,
        width: 1000,
        height: 1000,
        words: [
          // Adviser label at bottom right (x: 600..700, y: 800..820)
          {
            content: "Adviser",
            polygon: [600, 800, 700, 800, 700, 820, 600, 820],
            confidence: 0.99,
          },
          // Adviser printed name directly above (x: 550..750, y: 760..785)
          {
            content: "RICHARD",
            polygon: [550, 760, 630, 760, 630, 785, 550, 785],
            confidence: 0.98,
          },
          {
            content: "R.",
            polygon: [635, 760, 655, 760, 655, 785, 635, 785],
            confidence: 0.99,
          },
          {
            content: "RAQUEÑO",
            polygon: [660, 760, 750, 760, 750, 785, 660, 785],
            confidence: 0.98,
          },
          // Principal block below Adviser (x: 600..750, y: 880..930) - should NOT be chosen
          {
            content: "Principal",
            polygon: [600, 910, 700, 910, 700, 930, 600, 930],
            confidence: 0.99,
          },
          {
            content: "Mr. Leizel Moral Villa",
            polygon: [550, 880, 750, 880, 750, 905, 550, 905],
            confidence: 0.98,
          },
        ],
      },
    ],
  };

  const spatialResult = extractSpatialIdentity(mockLayout);
  assert.equal(spatialResult.adviser, "RICHARD R. RAQUEÑO");
});

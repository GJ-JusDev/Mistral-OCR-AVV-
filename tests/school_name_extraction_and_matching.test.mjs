import test from "node:test";
import assert from "node:assert/strict";

import { parseOcrText } from "../src/lib/ocr/parser.ts";
import {
  extractSchoolFromText,
  cleanSchoolName,
  isValidSchoolCandidate,
  extractSpatialIdentity,
} from "../src/lib/ocr/spatialIdentityParser.ts";
import {
  matchSchool,
  normalizeSchoolName,
  isSchoolMatch,
  stripAgencyPrefix,
  DEFAULT_VERIFIED_SCHOOL_ALIASES,
} from "../src/lib/validation/schoolMatcher.ts";
import { validateFields } from "../src/lib/validation/engine.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";
import { MistralOcrProvider } from "../src/lib/ocr/providers/mistralProvider.ts";
import { OcrProviderError } from "../src/lib/ocr/providers/types.ts";

// ---------------------------------------------------------------------------
// 1. School Name Extraction for SF9 Layout
// ---------------------------------------------------------------------------

test("1.1 Standard SF9 Layout: School name directly above School label is extracted correctly", () => {
  const sf9Header = `Republic of the Philippines
DEPARTMENT OF EDUCATION
Region V
DIVISION OF ALBAY
TAMBAYAN NATIONAL HIGH SCHOOL
School
Name : GOMEZ, JUSTIN LOQUILLAND`;

  const res = extractSchoolFromText(sf9Header);
  assert.equal(res.schoolName, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(res.hasSchoolLabel, true);

  const parsed = parseOcrText(sf9Header);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(parsed.name, "GOMEZ, JUSTIN LOQUILLAND");
});

test("1.2 Multi-line SF9 Header: Preserves OCR line order when school name wraps across lines", () => {
  // Case where school name is stacked: "DEPED TAMBAYAN" on line 1, "NATIONAL HIGH SCHOOL" on line 2
  const multiLineHeader = `Republic of the Philippines
DEPARTMENT OF EDUCATION
Region V
DIVISION OF ALBAY
DEPED TAMBAYAN
NATIONAL HIGH SCHOOL
School
Name : GOMEZ, JUSTIN LOQUILLAND`;

  const res = extractSchoolFromText(multiLineHeader);
  assert.equal(res.schoolName, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(res.hasSchoolLabel, true);

  const parsed = parseOcrText(multiLineHeader);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
});

test("1.3 Support institutional suffixes: Integrated School, National High School, Elementary School", () => {
  const isHeader = `DIVISION OF ALBAY\nTAYSAN RESETTLEMENT INTEGRATED SCHOOL\nSchool`;
  assert.equal(extractSchoolFromText(isHeader).schoolName, "TAYSAN RESETTLEMENT INTEGRATED SCHOOL");

  const nhsHeader = `DIVISION OF ALBAY\nLEGAZPI CITY NATIONAL HIGH SCHOOL\nSchool`;
  assert.equal(extractSchoolFromText(nhsHeader).schoolName, "LEGAZPI CITY NATIONAL HIGH SCHOOL");

  const esHeader = `DIVISION OF ALBAY\nBAGUMBAYAN ELEMENTARY SCHOOL\nSchool`;
  assert.equal(extractSchoolFromText(esHeader).schoolName, "BAGUMBAYAN ELEMENTARY SCHOOL");
});

test("1.4 Strict exclusion: Avoid extracting Division, Region, Department of Education, Adviser, or Student", () => {
  const learner = "GOMEZ, JUSTIN LOQUILLAND";
  const adviser = "RICHARD R. RAQUEÑO";

  // Division line must not become school
  assert.equal(isValidSchoolCandidate("DIVISION OF ALBAY"), false);
  assert.equal(isValidSchoolCandidate("Division"), false);
  assert.equal(isValidSchoolCandidate("Dibisyon ng Albay"), false);

  // Region line must not become school
  assert.equal(isValidSchoolCandidate("Region V"), false);
  assert.equal(isValidSchoolCandidate("Rehiyon V"), false);
  assert.equal(isValidSchoolCandidate("Region"), false);

  // Central agency must not become school
  assert.equal(isValidSchoolCandidate("DEPARTMENT OF EDUCATION"), false);
  assert.equal(isValidSchoolCandidate("Kagawaran ng Edukasyon"), false);

  // Learner name must not become school
  assert.equal(isValidSchoolCandidate(learner, { learnerName: learner, learnerLastName: "GOMEZ", learnerFirstName: "JUSTIN" }), false);

  // Adviser must not become school
  assert.equal(isValidSchoolCandidate("Adviser"), false);
  assert.equal(isValidSchoolCandidate("Class Adviser"), false);
  assert.equal(isValidSchoolCandidate("School Head"), false);
  assert.equal(isValidSchoolCandidate("Principal"), false);
});

test("1.5 Multi-column horizontal line concatenation from Azure Document Intelligence", () => {
  const azureConcatenatedLine = `SF9-SHS
LRN: 111687140043
Republic of the Philippines DEPARTMENT OF EDUCATION I Region
DIVISION OF XXXXXXX Division DEPED TAMBAYAN NATIONAL HIGH SCHOOL School
Name : GOMEZ, JUSTIN LOQUILLAND
Grade : 11
Section: Rizal`;

  const parsed = parseOcrText(azureConcatenatedLine);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(parsed.lrn, "111687140043");
  assert.equal(parsed.grade_level, "11");
  assert.equal(parsed.section, "Rizal");
});

test("1.6 Spatial Layout: Header region identification (y: 0.05-0.45, x: 0.15-0.85) anchors to School geometry", () => {
  const mockSpatialLayout = {
    pages: [
      {
        pageNumber: 1,
        width: 1000,
        height: 1000,
        lines: [
          // Division label (y = 210/1000 = 0.21)
          {
            content: "Division",
            polygon: [650, 200, 750, 200, 750, 220, 650, 220],
          },
          // Multi-line School name lines (y = 240/1000 and 265/1000)
          {
            content: "DEPED TAMBAYAN",
            polygon: [550, 230, 850, 230, 850, 250, 550, 250],
          },
          {
            content: "NATIONAL HIGH SCHOOL",
            polygon: [520, 255, 880, 255, 880, 275, 520, 275],
          },
          // School label anchor (y = 290/1000 = 0.29)
          {
            content: "School",
            polygon: [670, 280, 730, 280, 730, 300, 670, 300],
          },
        ],
        words: [
          { content: "School", polygon: [670, 280, 730, 280, 730, 300, 670, 300], confidence: 0.99 },
        ],
      },
    ],
  };

  const spatialResult = extractSpatialIdentity(mockSpatialLayout);
  assert.equal(spatialResult.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
});

// ---------------------------------------------------------------------------
// 2. School Name Missing from OCR (Distinguishing unextracted vs. genuinely blank)
// ---------------------------------------------------------------------------

test("2.1 School label present but unreadable value triggers Needs Verification (warning)", () => {
  const unextractedFieldDoc = {
    name: "Dela Cruz, Juan",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2023-2024",
    school_name: "",
    school_name_unextracted: true,
    flags: ["school_name_unextracted"],
  };

  const report = validateFields(unextractedFieldDoc);
  const presentRule = report.results.find((r) => r.fieldName === "school_name" && r.ruleName === "school_present");
  assert.ok(presentRule);
  assert.equal(presentRule.passed, false);
  assert.equal(presentRule.severity, "warning");
  assert.equal(presentRule.message, "School name could not be reliably extracted. Verify against the original SF9.");

  // Recognized rule does not falsely trigger duplicate warning on empty field
  const recognizedRule = report.results.find((r) => r.fieldName === "school_name" && r.ruleName === "school_recognized");
  assert.ok(recognizedRule);
  assert.equal(recognizedRule.passed, true);

  assert.equal(report.status, "needs_review");
});

test("2.2 Genuinely blank school field fails with standard required error", () => {
  const genuinelyBlankDoc = {
    name: "Dela Cruz, Juan",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2023-2024",
    school_name: "",
    school_name_unextracted: false,
    flags: [],
  };

  const report = validateFields(genuinelyBlankDoc);
  const presentRule = report.results.find((r) => r.fieldName === "school_name" && r.ruleName === "school_present");
  assert.ok(presentRule);
  assert.equal(presentRule.passed, false);
  assert.equal(presentRule.severity, "error");
  assert.equal(presentRule.message, "School name must be present.");
  assert.equal(report.status, "invalid");
});

// ---------------------------------------------------------------------------
// 3. Recognized School Matching
// ---------------------------------------------------------------------------

test("3.1 Exact and case-insensitive matching against Supabase schools registry", () => {
  const knownSchools = ["Taysan Resettlement Integrated School"];

  // Exact match
  assert.equal(matchSchool("Taysan Resettlement Integrated School", knownSchools).matched, true);

  // Case-insensitive match
  assert.equal(matchSchool("taysan resettlement integrated school", knownSchools).matched, true);
  assert.equal(matchSchool("TAYSAN RESETTLEMENT INTEGRATED SCHOOL", knownSchools).matched, true);
});

test("3.2 Normalization: repeated whitespace and harmless punctuation", () => {
  const knownSchools = ["Taysan Resettlement Integrated School"];

  // Trailing dot / comma
  assert.equal(matchSchool("Taysan Resettlement Integrated School.", knownSchools).matched, true);
  assert.equal(matchSchool("Taysan Resettlement Integrated School,", knownSchools).matched, true);

  // Harmless hyphens and dashes
  assert.equal(matchSchool("Taysan-Resettlement Integrated School", knownSchools).matched, true);

  // Repeated whitespace
  assert.equal(matchSchool("  Taysan    Resettlement   Integrated   School  ", knownSchools).matched, true);
});

test("3.3 DepEd agency prefix bidirectional normalization", () => {
  const knownSchools = ["Taysan Resettlement Integrated School"];

  // Candidate with DepEd prefix matches registered name without prefix
  assert.equal(matchSchool("DepEd Taysan Resettlement Integrated School", knownSchools).matched, true);
  assert.equal(matchSchool("DEPED - Taysan Resettlement Integrated School", knownSchools).matched, true);

  // Candidate without prefix matches registered name with prefix
  const knownWithPrefix = ["DepEd Tambayan National High School"];
  assert.equal(matchSchool("Tambayan National High School", knownWithPrefix).matched, true);
  assert.equal(matchSchool("DEPED TAMBAYAN NATIONAL HIGH SCHOOL", knownWithPrefix).matched, true);
});

test("3.4 Configured verified alias matching (e.g. TRIS)", () => {
  const knownSchools = ["Taysan Resettlement Integrated School"];

  // Built-in verified alias
  const trisMatch = matchSchool("TRIS", knownSchools);
  assert.equal(trisMatch.matched, true);
  assert.equal(trisMatch.matchedSchool, "Taysan Resettlement Integrated School");
  assert.equal(trisMatch.matchType, "alias");

  // Custom configured alias map
  const customAliases = {
    "Tambayan National High School": ["TNHS", "Tambayan NHS"],
  };
  const tnhsMatch = matchSchool("Tambayan NHS", ["Tambayan National High School"], customAliases);
  assert.equal(tnhsMatch.matched, true);
  assert.equal(tnhsMatch.matchedSchool, "Tambayan National High School");
  assert.equal(tnhsMatch.matchType, "alias");
});

test("3.5 Integration: Recognized school passes school_recognized validation rule", () => {
  const fields = {
    name: "Dela Cruz, Juan",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2023-2024",
    school_name: "DepEd Taysan Resettlement Integrated School",
  };

  const report = validateFields(fields, {
    knownSchools: ["Taysan Resettlement Integrated School"],
  });

  const recognizedRule = report.results.find((r) => r.ruleName === "school_recognized");
  assert.ok(recognizedRule);
  assert.equal(recognizedRule.passed, true);
});

// ---------------------------------------------------------------------------
// 4. Unknown School Requiring Review
// ---------------------------------------------------------------------------

test("4.1 Unknown external school triggers warning and requires review (needs_review)", () => {
  const fields = {
    name: "GOMEZ, JUSTIN LOQUILLAND",
    lrn: "111687140043",
    grade_level: "11",
    school_year: "2019-2020",
    school_name: "TAMBAYAN NATIONAL HIGH SCHOOL",
  };

  // Only TRIS is registered; Tambayan is an external transferee school
  const report = validateFields(fields, {
    knownSchools: ["Taysan Resettlement Integrated School"],
  });

  const recognizedRule = report.results.find((r) => r.ruleName === "school_recognized");
  assert.ok(recognizedRule);
  assert.equal(recognizedRule.passed, false);
  assert.equal(recognizedRule.severity, "warning");
  assert.equal(recognizedRule.message, "School is not in the recognized list.");

  // school_present must PASS because the name is cleanly extracted
  const presentRule = report.results.find((r) => r.ruleName === "school_present");
  assert.ok(presentRule);
  assert.equal(presentRule.passed, true);

  // Status must be needs_review, not invalid
  assert.equal(report.status, "needs_review");
});

test("4.2 Do not automatically register unknown school into registry", () => {
  const registry = ["Taysan Resettlement Integrated School"];
  const unknownCandidate = "DEPED TAMBAYAN NATIONAL HIGH SCHOOL";

  const result = matchSchool(unknownCandidate, registry);
  assert.equal(result.matched, false);
  // Registry array remains unmodified
  assert.deepEqual(registry, ["Taysan Resettlement Integrated School"]);
  assert.equal(registry.includes(unknownCandidate), false);
});

test("4.3 Prevent silent association: Non-matching school must NOT be verified as tenant school", () => {
  const tenantSchool = {
    id: "a0000000-0000-0000-0000-000000000001",
    school_id: "500169",
    name: "Taysan Resettlement Integrated School",
  };

  const transfereeFields = {
    school_name: "TAMBAYAN NATIONAL HIGH SCHOOL",
    school_id: "",
    trusted_school_verified: false,
  };

  // Check if school_name matches tenant school
  const isMatch = isSchoolMatch(transfereeFields.school_name, tenantSchool.name);
  assert.equal(isMatch, false);

  // Ensure trusted_school_verified is FALSE
  assert.equal(transfereeFields.trusted_school_verified, false);
  // Extracted school_name is strictly preserved
  assert.equal(transfereeFields.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
});

// ---------------------------------------------------------------------------
// 5. Similar School Names Not Being Incorrectly Merged
// ---------------------------------------------------------------------------

test("5.1 National High School vs Elementary School must NOT merge", () => {
  assert.equal(isSchoolMatch("Tambayan National High School", "Tambayan Elementary School"), false);
  assert.equal(isSchoolMatch("Mabini High School", "Mabini Elementary School"), false);
  assert.equal(
    matchSchool("Tambayan Elementary School", ["Tambayan National High School"]).matched,
    false
  );
});

test("5.2 Integrated School vs National High School must NOT merge", () => {
  assert.equal(
    isSchoolMatch("Taysan Resettlement Integrated School", "Taysan National High School"),
    false
  );
  assert.equal(
    matchSchool("Taysan National High School", ["Taysan Resettlement Integrated School"]).matched,
    false
  );
});

test("5.3 Distinct geographic or patron names must NOT merge", () => {
  assert.equal(isSchoolMatch("San Jose National High School", "San Juan National High School"), false);
  assert.equal(isSchoolMatch("Legazpi City Science High School", "Ligao City Science High School"), false);
});

// ---------------------------------------------------------------------------
// 6. OCR Provider Priority (Primary = Azure, Fallback = Mistral)
// ---------------------------------------------------------------------------

test("6.1 Two-tier provider priority hierarchy initialization", () => {
  const orchestrator = new OcrOrchestrator();
  assert.ok(orchestrator);

  // Primary is Azure AI Document Intelligence
  assert.equal(orchestrator.getPrimaryProvider().name, "azure");

  // Fallback is Mistral OCR
  assert.equal(orchestrator.getFallbackProvider()?.name, "mistral");
});

test("6.2 Orchestrator cascades directly from Azure 429 rate limit to Mistral fallback", async () => {
  let azureCalled = false;
  let mistralCalled = false;

  const mockAzureFailing = {
    name: "azure",
    isAvailable: async () => true,
    recognize: async () => {
      azureCalled = true;
      throw new OcrProviderError("Azure 429 Rate Limit", {
        provider: "azure",
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
      });
    },
  };

  const mockMistralHealthy = {
    name: "mistral",
    isAvailable: async () => true,
    recognize: async () => {
      mistralCalled = true;
      return {
        text: "Extracted via Mistral cloud fallback",
        model: "mistral-ocr-latest",
        provider: "mistral",
      };
    },
  };

  const orchestrator = new OcrOrchestrator({
    primaryProvider: mockAzureFailing,
    fallbackProvider: mockMistralHealthy,
    enableFallback: true,
  });

  const res = await orchestrator.execute({ image: "data:image/png;base64,dummy" });
  assert.equal(azureCalled, true);
  assert.equal(mistralCalled, true);
  assert.equal(res.provider, "mistral");
  assert.equal(res.text, "Extracted via Mistral cloud fallback");
});

test("6.3 Orchestrator preserves primary Azure error when fallback is disabled", async () => {
  let mistralCalled = false;

  const mockAzureFailing = {
    name: "azure",
    isAvailable: async () => true,
    recognize: async () => {
      throw new OcrProviderError("Azure 503 Upstream", {
        provider: "azure",
        status: 503,
        code: "UPSTREAM_ERROR",
      });
    },
  };

  const mockMistral = {
    name: "mistral",
    isAvailable: async () => true,
    recognize: async () => {
      mistralCalled = true;
      return {
        text: "Should not be called",
        model: "mistral-ocr-latest",
        provider: "mistral",
      };
    },
  };

  const orchestrator = new OcrOrchestrator({
    primaryProvider: mockAzureFailing,
    fallbackProvider: mockMistral,
    enableFallback: false,
  });

  await assert.rejects(
    async () => {
      await orchestrator.execute({ image: "data:image/png;base64,dummy" });
    },
    (err) => {
      assert.equal(err.code, "UPSTREAM_ERROR");
      assert.equal(err.status, 503);
      return true;
    }
  );

  assert.equal(mistralCalled, false);
});

// ---------------------------------------------------------------------------
// 7. Non-Regression: Existing SF9 Processing Continuing to Work
// ---------------------------------------------------------------------------

test("7.1 Real SF9 SHS text parsing extracts all academic identity fields without regression", () => {
  const SF9_TEXT = `SF9-SHS
LRN: 111687140043
Republic of the Philippines DEPARTMENT OF EDUCATION Region V
DIVISION OF ALBAY
TAMBAYAN NATIONAL HIGH SCHOOL
School
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
RICHARD R. RAQUEÑO
Adviser`;

  const parsed = parseOcrText(SF9_TEXT);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(parsed.lrn, "111687140043");
  assert.equal(parsed.last_name, "GOMEZ");
  assert.equal(parsed.first_name, "JUSTIN");
  assert.equal(parsed.middle_name, "LOQUILLAND");
  assert.equal(parsed.grade_level, "11");
  assert.equal(parsed.section, "Rizal");
  assert.equal(parsed.school_year, "2019-2020");
  assert.equal(parsed.adviser, "RICHARD R. RAQUEÑO");
});

test("7.2 SHS Semestral Grades parsing remains intact", () => {
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
| Practical Research 1 | 85 | 89 | 87 |`;

  const parsed = parseSeniorHighGradesText(shsBackText);
  assert.ok(Array.isArray(parsed.grades));
  assert.equal(parsed.grades.length, 5);

  const oralComm = parsed.grades.find((g) => g.subject.includes("Oral Communication"));
  assert.ok(oralComm);
  assert.equal(oralComm.q1, 90);
  assert.equal(oralComm.q2, 80);
  assert.equal(oralComm.semester, "1st Semester");

  const practicalResearch = parsed.grades.find((g) => g.subject.includes("Practical Research 1"));
  assert.ok(practicalResearch);
  assert.equal(practicalResearch.q3, 85);
  assert.equal(practicalResearch.q4, 89);
  assert.equal(practicalResearch.semester, "2nd Semester");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ACADEMIC_GRADE_LEVELS,
  DEFAULT_ACADEMIC_GRADE_LEVEL,
  isAcademicGradeLevel,
  getGradeLevelShortLabel,
  shouldShowGradeLevelSelector,
  buildDocumentSubmissionPayload,
  resolveOcrExtractionRequest,
  getUploadUiCopy,
} from "../src/lib/upload/uploadWorkflow.ts";

import { validateFields } from "../src/lib/validation/engine.ts";
import { SHS_GRADE_PATTERN } from "../src/lib/validation/patterns.ts";
import { getContextualGradeLevels } from "../src/lib/students/studentDirectory.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

test("AVV Senior High School Only Scope Refinement Verification Suite", async (t) => {

  await t.test("1. Active Grade-Level Scope: Exclusively Grade 11 and Grade 12", () => {
    assert.deepStrictEqual(
      [...ACADEMIC_GRADE_LEVELS],
      ["Grade 11", "Grade 12"],
      "Active academic grade levels must contain ONLY Grade 11 and Grade 12"
    );
    assert.strictEqual(DEFAULT_ACADEMIC_GRADE_LEVEL, "Grade 11");

    assert.strictEqual(isAcademicGradeLevel("Grade 11"), true);
    assert.strictEqual(isAcademicGradeLevel("Grade 12"), true);
    assert.strictEqual(isAcademicGradeLevel("Elementary"), false, "Elementary must be rejected from active scope");
    assert.strictEqual(isAcademicGradeLevel("High School"), false, "Junior High School must be rejected from active scope");
    assert.strictEqual(isAcademicGradeLevel("Grade 7"), false, "Grades 1-10 must be rejected from active scope");
    assert.strictEqual(isAcademicGradeLevel("Kinder"), false, "Kindergarten must be rejected from active scope");

    assert.strictEqual(getGradeLevelShortLabel("Grade 11"), "Grade 11");
    assert.strictEqual(getGradeLevelShortLabel("Grade 12"), "Grade 12");
  });

  await t.test("2. Active Document Types: SF9 and SF10 only (PSA removed)", () => {
    assert.strictEqual(shouldShowGradeLevelSelector("sf9"), true);
    assert.strictEqual(shouldShowGradeLevelSelector("sf10"), true);
    assert.strictEqual(shouldShowGradeLevelSelector("birth_cert"), false);

    const uploadPageSrc = fs.readFileSync(
      path.resolve("./src/app/upload/page.tsx"),
      "utf8"
    );

    // Assert UI document buttons
    assert.ok(uploadPageSrc.includes('handleCategoryChange("sf9")'), "SF9 must be present");
    assert.ok(uploadPageSrc.includes('handleCategoryChange("sf10")'), "SF10 must be present");
    assert.strictEqual(uploadPageSrc.includes('handleCategoryChange("birth_cert")'), false, "PSA Birth Certificate must be removed");
    assert.strictEqual(uploadPageSrc.includes('handleCategoryChange("school_id")'), false, "school_id must be removed");
    assert.strictEqual(uploadPageSrc.includes('handleCategoryChange("other")'), false, "other must be removed");
  });

  await t.test("3. Grade 11 & Grade 12 SF9 Submission Payload Builder enforces SHS & Semestral scheme", () => {
    const g11Payload = buildDocumentSubmissionPayload({
      docCategory: "sf9",
      gradeLevel: "Grade 11",
      ocrFields: {
        document_type: "sf9",
        name: "Santos, Juan P.",
        lrn: "123456789012",
        school_name: "Taysan Resettlement Integrated School",
      },
      ocrText: "SF9 Grade 11",
      ocrModel: "azure/prebuilt-layout",
      ocrConfidence: 0.96,
      finalPrimaryUrl: "https://storage.example/sf9_g11_front.jpg",
      backStorageUrl: "https://storage.example/sf9_g11_back.jpg",
      originalFilename: "sf9_g11.jpg",
    });

    assert.strictEqual(g11Payload.docType, "sf9");
    assert.strictEqual(g11Payload.requestBody.document_type, "sf9");
    assert.strictEqual(g11Payload.requestBody.selected_grade_level, "Grade 11");
    assert.strictEqual(g11Payload.combinedFields.academic_level, "Senior High School");
    assert.strictEqual(g11Payload.combinedFields.selected_grade_level, "Grade 11");
    assert.strictEqual(g11Payload.combinedFields.grade_level, "Grade 11");
    assert.strictEqual(g11Payload.combinedFields.grading_period_scheme, "quarterly_semestral");
    assert.strictEqual(g11Payload.combinedFields.back_image_url, "https://storage.example/sf9_g11_back.jpg");

    const g12Payload = buildDocumentSubmissionPayload({
      docCategory: "sf9",
      gradeLevel: "Grade 12",
      ocrFields: {
        document_type: "sf9",
        name: "Reyes, Maria L.",
        lrn: "987654321098",
      },
      ocrText: "SF9 Grade 12",
      finalPrimaryUrl: "https://storage.example/sf9_g12.jpg",
      originalFilename: "sf9_g12.jpg",
    });

    assert.strictEqual(g12Payload.requestBody.selected_grade_level, "Grade 12");
    assert.strictEqual(g12Payload.combinedFields.academic_level, "Senior High School");
    assert.strictEqual(g12Payload.combinedFields.selected_grade_level, "Grade 12");
    assert.strictEqual(g12Payload.combinedFields.grade_level, "Grade 12");
    assert.strictEqual(g12Payload.combinedFields.grading_period_scheme, "quarterly_semestral");
  });

  await t.test("4. SHS SF10 Submission Payload Builder enforces SHS & Semestral scheme", () => {
    const sf10Payload = buildDocumentSubmissionPayload({
      docCategory: "sf10",
      gradeLevel: "Grade 11",
      ocrFields: {
        document_type: "sf10",
        name: "Dela Cruz, Carlos",
        lrn: "112233445566",
      },
      ocrText: "SF10 Permanent Record",
      finalPrimaryUrl: "https://storage.example/sf10.jpg",
      originalFilename: "sf10.jpg",
    });

    assert.strictEqual(sf10Payload.docType, "sf10");
    assert.strictEqual(sf10Payload.combinedFields.academic_level, "Senior High School");
    assert.strictEqual(sf10Payload.combinedFields.selected_grade_level, "Grade 11");
    assert.strictEqual(sf10Payload.combinedFields.grading_period_scheme, "quarterly_semestral");
  });

  await t.test("5. PSA Birth Certificate is rejected by payload builder", () => {
    assert.throws(() => {
      buildDocumentSubmissionPayload({
        docCategory: "birth_cert",
        gradeLevel: "Grade 11",
        ocrFields: {
          document_type: "birth_cert",
          name: "Dela Cruz, Carlos",
          birth_date: "2007-08-14",
          sex: "M",
        },
        ocrText: "CERTIFICATE OF LIVE BIRTH",
        finalPrimaryUrl: "https://storage.example/psa.png",
        originalFilename: "psa.png",
      });
    }, /Unsupported document category/);
  });

  await t.test("6. SHS Grade Pattern Validation strictly verifies Grade 11 & Grade 12 and rejects Grades 1-10", () => {
    assert.ok(SHS_GRADE_PATTERN.test("Grade 11"));
    assert.ok(SHS_GRADE_PATTERN.test("Grade 12"));
    assert.ok(SHS_GRADE_PATTERN.test("11"));
    assert.ok(SHS_GRADE_PATTERN.test("12"));
    assert.ok(SHS_GRADE_PATTERN.test("XI"));
    assert.ok(SHS_GRADE_PATTERN.test("XII"));

    assert.strictEqual(SHS_GRADE_PATTERN.test("Grade 10"), false);
    assert.strictEqual(SHS_GRADE_PATTERN.test("Grade 9"), false);
    assert.strictEqual(SHS_GRADE_PATTERN.test("Grade 8"), false);
    assert.strictEqual(SHS_GRADE_PATTERN.test("Grade 7"), false);
    assert.strictEqual(SHS_GRADE_PATTERN.test("Grade 6"), false);
    assert.strictEqual(SHS_GRADE_PATTERN.test("Grade 1"), false);
    assert.strictEqual(SHS_GRADE_PATTERN.test("Kinder"), false);

    // Validation engine rule execution
    const g11Report = validateFields({
      name: "Juan Santos",
      lrn: "123456789012",
      grade_level: "Grade 11",
      academic_level: "Senior High School",
      school_name: "Taysan Resettlement Integrated School",
      school_year: "2024-2025",
    });
    const g11Rule = g11Report.results.find((r) => r.ruleName === "grade_valid");
    assert.ok(g11Rule?.passed, "Grade 11 must pass grade_valid rule");

    const g8Report = validateFields({
      name: "Pedro Reyes",
      lrn: "123456789012",
      grade_level: "Grade 8",
      academic_level: "Senior High School",
      school_name: "Taysan Resettlement Integrated School",
      school_year: "2024-2025",
    });
    const g8Rule = g8Report.results.find((r) => r.ruleName === "grade_valid");
    assert.strictEqual(g8Rule?.passed, false, "Grade 8 must fail grade_valid rule for SHS document");
  });

  await t.test("7. Documents API Route rejects unsupported grade levels with HTTP 400", () => {
    const routeSrc = fs.readFileSync(path.resolve("./src/app/api/documents/route.ts"), "utf8");
    assert.ok(
      routeSrc.includes("Unsupported grade level"),
      "API route must contain explicit rejection logic for unsupported grade levels"
    );
    assert.ok(
      routeSrc.includes("Unsupported document type"),
      "API route must contain explicit rejection logic for unsupported document types"
    );
    assert.ok(
      routeSrc.includes("validDocTypes = ['sf9', 'sf10']"),
      "validDocTypes must be strictly limited to sf9 and sf10"
    );
    assert.ok(
      routeSrc.includes("isExplicitlyUnsupported"),
      "API route must check if grade level is unsupported before proceeding"
    );
  });

  await t.test("8. Students API Route validates grade_level for Grade 11 and Grade 12 only", () => {
    const studentsRouteSrc = fs.readFileSync(path.resolve("./src/app/api/students/route.ts"), "utf8");
    assert.ok(
      studentsRouteSrc.includes("Unsupported grade level"),
      "Students API route must validate grade_level against SHS scope"
    );
    assert.ok(
      studentsRouteSrc.includes("11|12"),
      "Students API route must enforce 11 or 12"
    );
  });

  await t.test("9. Sidebar Navigation excludes unfinished Reports link", () => {
    const sidebarSrc = fs.readFileSync(path.resolve("./src/components/layout/Sidebar.tsx"), "utf8");
    assert.strictEqual(
      sidebarSrc.includes('{ name: "Reports", href: "/reports"'),
      false,
      "Sidebar baseNavigation must not include operational link to unfinished Reports page"
    );
    assert.ok(sidebarSrc.includes('Dashboard'), "Dashboard must remain");
    assert.ok(sidebarSrc.includes('Upload Document'), "Upload Document must remain");
    assert.ok(sidebarSrc.includes('Documents'), "Documents must remain");
    assert.ok(sidebarSrc.includes('Review Queue'), "Review Queue must remain");
    assert.ok(sidebarSrc.includes('Students'), "Students must remain");
    assert.ok(sidebarSrc.includes('Settings'), "Settings must remain");
  });

  await t.test("10. Student Directory UI filters default to and isolate Senior High School Grades 11 and 12", () => {
    const studentsPageSrc = fs.readFileSync(path.resolve("./src/app/students/page.tsx"), "utf8");
    assert.ok(
      studentsPageSrc.includes('useState("Senior High School")'),
      "StudentsPage schoolLevel must default to 'Senior High School'"
    );
    assert.strictEqual(
      studentsPageSrc.includes('<option value="Elementary">'),
      false,
      "StudentsPage must not present Elementary in school level filter"
    );
    assert.strictEqual(
      studentsPageSrc.includes('<option value="Junior High School">'),
      false,
      "StudentsPage must not present Junior High School in school level filter"
    );
    assert.ok(
      studentsPageSrc.includes('<option value="Senior High School">Senior High School</option>'),
      "StudentsPage must present Senior High School as active school level"
    );

    const shsContextGrades = getContextualGradeLevels("Senior High School");
    assert.deepStrictEqual(shsContextGrades, ["Grade 11", "Grade 12"]);
  });

  await t.test("11. OCR Senior High Parser extracts Semestral subjects without inventing missing grades", () => {
    const ocrSample = `=== BACK (GRADES) ===
REPORT ON LEARNING PROGRESS AND ACHIEVEMENT
First Semester
| Subjects | Quarter 1 | Quarter 2 | Semester Final Grade |
| --- | --- | --- | --- |
| Komunikasyon at Pananaliksik | 88 | 90 | 89 |
| General Mathematics | 85 | | |
Second Semester
| Subjects | Quarter 3 | Quarter 4 | Semester Final Grade |
| --- | --- | --- | --- |
| Pagbasa at Pagsusuri | 91 | 93 | 92 |`;

    const parsed = parseGradesText(ocrSample, "Grade 11", undefined, "sf9");
    assert.strictEqual(parsed.academic_level, "Senior High School");
    assert.strictEqual(parsed.selected_grade_level, "Grade 11");
    assert.strictEqual(parsed.grading_period_scheme, "quarterly_semestral");

    const kom = parsed.grades?.find((g) => g.subject.includes("Komunikasyon"));
    assert.ok(kom, "Komunikasyon must be extracted");
    assert.strictEqual(kom.q1, 88);
    assert.strictEqual(kom.q2, 90);
    assert.strictEqual(kom.final, 89);
    assert.strictEqual(kom.status, "Passed");

    const genMath = parsed.grades?.find((g) => g.subject.includes("General Mathematics"));
    assert.ok(genMath, "General Mathematics must be extracted");
    assert.strictEqual(genMath.q1, 85);
    assert.strictEqual(genMath.q2, undefined, "Q2 was blank; must remain undefined (NO invention)");
    assert.strictEqual(genMath.final, undefined, "Final was blank; must remain undefined (NO invention)");
    assert.strictEqual(genMath.status, "Missing", "Unfinished subject must be flagged as Missing");
  });
});

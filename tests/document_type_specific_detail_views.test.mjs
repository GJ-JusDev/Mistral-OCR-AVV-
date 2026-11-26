import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

describe("Document-Type-Specific Detail Views in /documents Verification Suite", () => {
  const docDetailPagePath = path.join(rootDir, "src", "app", "documents", "[id]", "page.tsx");
  const ocrResultCardPath = path.join(rootDir, "src", "components", "ocr", "OcrResultCard.tsx");
  const docTablePath = path.join(rootDir, "src", "components", "documents", "DocumentTable.tsx");

  const docDetailPageSrc = fs.readFileSync(docDetailPagePath, "utf8");
  const ocrResultCardSrc = fs.readFileSync(ocrResultCardPath, "utf8");
  const docTableSrc = fs.readFileSync(docTablePath, "utf8");

  test("1. PSA (birth_cert) in /documents/[id] strictly isolates civil identity and suppresses school context", () => {
    // 1a. Must identify PSA document type
    assert.ok(
      docDetailPageSrc.includes('document.document_type || "").toLowerCase().trim() === "birth_cert"') ||
      docDetailPageSrc.includes('isPsa'),
      "Must define isPsa flag for birth_cert and psa document types"
    );

    // 1b. Header displays PSA Birth Certificate
    assert.ok(
      docDetailPageSrc.includes('isPsa ? "PSA BIRTH CERTIFICATE"'),
      "Header must show dedicated PSA BIRTH CERTIFICATE label instead of generic code"
    );

    // 1c. Generic Assigned Scan Context block (grade_level, section, strand, SY) is suppressed for PSA
    assert.ok(
      docDetailPageSrc.includes("isPsa ? (") && docDetailPageSrc.includes("Assigned Scan Context:"),
      "Assigned Scan Context block must be bypassed when isPsa is true"
    );

    // 1d. Passes documentType prop to OcrResultCard
    assert.ok(
      docDetailPageSrc.includes("documentType={document.document_type}"),
      "Must pass documentType to OcrResultCard for strict document-type branching"
    );
  });

  test("2. Original Document viewer provides 90° Rotate control and supports upright preprocessed PSA display", () => {
    // 2a. Rotate 90° control present in left column
    assert.ok(
      docDetailPageSrc.includes("90° Rotate") || docDetailPageSrc.includes("Rotate 90°"),
      "Must provide a 90° Rotate button in the left viewer"
    );
    assert.ok(
      docDetailPageSrc.includes("setImageRotation") && docDetailPageSrc.includes("(prev + 90) % 360"),
      "Must rotate scan 90 degrees sequentially (0 -> 90 -> 180 -> 270)"
    );

    // 2b. Automatically selects upright preprocessed/corrected image if available for PSA
    assert.ok(
      docDetailPageSrc.includes("full_corrected_image_url") &&
      docDetailPageSrc.includes("preprocessed_image_url"),
      "Must inspect upright preprocessed/corrected image URLs for upright PSA viewing"
    );

    // 2c. Rotate transformation applied to image element
    assert.ok(
      docDetailPageSrc.includes("transform: `rotate(${imageRotation}deg)`"),
      "Image element must apply rotate transform based on rotation state"
    );
  });

  test("3. OcrResultCard branches strictly by document_type and defines dedicated PSA Civil Identity layout", () => {
    // 3a. Document-type branching variables
    assert.ok(
      ocrResultCardSrc.includes("effectiveDocType"),
      "Must resolve effectiveDocType"
    );
    assert.ok(
      ocrResultCardSrc.includes("const isPsa =") &&
      ocrResultCardSrc.includes("const isSf1 =") &&
      ocrResultCardSrc.includes("const isSf2 =") &&
      ocrResultCardSrc.includes("const isSf9 =") &&
      ocrResultCardSrc.includes("const isSf10 ="),
      "Must define document type flags for psa, sf1, sf2, sf9, and sf10"
    );

    // 3b. Dedicated PSA Civil Identity & Registry Details layout
    assert.ok(
      ocrResultCardSrc.includes("PSA Civil Identity & Registry Details") ||
      ocrResultCardSrc.includes("PSA Civil Identity &amp; Registry Details"),
      "Must render dedicated PSA Civil Identity & Registry Details layout"
    );

    // 3c. PSA card title and description are tailored
    assert.ok(
      ocrResultCardSrc.includes("PSA Civil Identity & Registry Card") &&
      ocrResultCardSrc.includes("RA 10173"),
      "Card title and description must be tailored to RA 10173 PSA civil identity"
    );
  });

  test("4. PSA detail layout displays ONLY the 6 PSA civil registry fields and strictly excludes Place of Birth and school fields", () => {
    // 4a. The 6 PSA Civil Registry fields MUST be present in the PSA layout:
    // 1) Child's Complete Name (plus First, Middle, Last)
    assert.ok(ocrResultCardSrc.includes("Child&apos;s Complete Name") || ocrResultCardSrc.includes("Child's Complete Name"));
    assert.ok(ocrResultCardSrc.includes("First Name"));
    assert.ok(ocrResultCardSrc.includes("Middle Name"));
    assert.ok(ocrResultCardSrc.includes("Last Name"));
    // 2) Date of Birth
    assert.ok(ocrResultCardSrc.includes("Date of Birth"));
    // 3) Sex (Male (M) / Female (F))
    assert.ok(ocrResultCardSrc.includes("Male (M)") && ocrResultCardSrc.includes("Female (F)"));
    // 4) Local Civil Registry / Certificate No.
    assert.ok(ocrResultCardSrc.includes("Local Civil Registry / Certificate No."));
    // 5) Mother's Maiden Name
    assert.ok(ocrResultCardSrc.includes("Mother&apos;s Maiden Name") || ocrResultCardSrc.includes("Mother's Maiden Name"));
    // 6) Father's Name
    assert.ok(ocrResultCardSrc.includes("Father&apos;s Name") || ocrResultCardSrc.includes("Father's Name"));

    // 4b. STRICT EXCLUSION: Place of Birth / place_of_birth must NEVER be rendered in OcrResultCard
    assert.strictEqual(
      ocrResultCardSrc.includes("place_of_birth"),
      false,
      "place_of_birth field must NOT appear in OcrResultCard"
    );
    assert.strictEqual(
      ocrResultCardSrc.includes("Place of Birth"),
      false,
      "Place of Birth label must NOT appear anywhere in OcrResultCard"
    );
    assert.strictEqual(
      ocrResultCardSrc.includes("birth_place"),
      false,
      "birth_place must NOT appear anywhere in OcrResultCard"
    );

    // 4c. When isPsa is true, generic LEARNER IDENTITY & FORM DETAILS block is completely skipped
    const psaSectionIdx = ocrResultCardSrc.indexOf("isPsa ? (");
    assert.ok(psaSectionIdx > 0, "Must branch on isPsa");
    const elseSectionIdx = ocrResultCardSrc.indexOf(": (", psaSectionIdx);
    assert.ok(elseSectionIdx > psaSectionIdx, "Must have an else branch for non-PSA");

    const psaBlockText = ocrResultCardSrc.substring(psaSectionIdx, elseSectionIdx);

    // Verify PSA block strictly excludes LRN, School Name, School ID, Grade Level, School Year, Track / Strand, Section, Class Adviser
    assert.strictEqual(psaBlockText.includes("Learner Reference No. (LRN)"), false);
    assert.strictEqual(psaBlockText.includes("School Name"), false);
    assert.strictEqual(psaBlockText.includes("School ID"), false);
    assert.strictEqual(psaBlockText.includes("Grade Level"), false);
    assert.strictEqual(psaBlockText.includes("School Year"), false);
    assert.strictEqual(psaBlockText.includes("Track / Strand"), false);
    assert.strictEqual(psaBlockText.includes("Class Adviser"), false);
    assert.strictEqual(psaBlockText.includes("Place of Birth"), false);

    // Verify PSA block strictly excludes academic grades and attendance
    assert.strictEqual(psaBlockText.includes("Subject Grades Tables"), false);
    assert.strictEqual(psaBlockText.includes("General Average for the Semester"), false);
    assert.strictEqual(psaBlockText.includes("Learner Attendance Record"), false);
    assert.strictEqual(psaBlockText.includes("Report on Learner"), false);
  });

  test("5. Honest per-field confidence percentage pills use correct threshold classes", () => {
    // >=85% emerald
    assert.ok(
      ocrResultCardSrc.includes("pct >= 85") &&
      ocrResultCardSrc.includes("bg-emerald-50") &&
      ocrResultCardSrc.includes("text-emerald-700"),
      "Must style >= 85% with emerald classes"
    );

    // 60-84% amber
    assert.ok(
      ocrResultCardSrc.includes("pct >= 60") &&
      ocrResultCardSrc.includes("bg-amber-50") &&
      ocrResultCardSrc.includes("text-amber-700"),
      "Must style 60-84% with amber classes"
    );

    // <60% or 0% slate
    assert.ok(
      ocrResultCardSrc.includes("bg-slate-100") &&
      ocrResultCardSrc.includes("text-slate-600"),
      "Must style <60% and 0% with slate classes"
    );

    // Honest zero confidence badge when value not detected
    assert.ok(
      ocrResultCardSrc.includes('title="0% — Not detected"') &&
      ocrResultCardSrc.includes("0%"),
      "Must produce an honest 0% slate pill when field is not detected"
    );
  });

  test("6. Non-PSA document types render tailored document-specific layouts", () => {
    // 6a. SF1 School & Section Metadata
    assert.ok(
      ocrResultCardSrc.includes("School & Section Metadata (SF1-SHS)") ||
      ocrResultCardSrc.includes("School &amp; Section Metadata (SF1-SHS)"),
      "SF1 must render School & Section Metadata header"
    );
    assert.ok(
      ocrResultCardSrc.includes("SF1 School Register Roster"),
      "SF1 must render SF1 School Register Roster"
    );

    // 6b. SF2 School & Section Metadata + Monthly Attendance Grid
    assert.ok(
      ocrResultCardSrc.includes("School & Section Metadata (SF2-SHS)") ||
      ocrResultCardSrc.includes("School &amp; Section Metadata (SF2-SHS)"),
      "SF2 must render School & Section Metadata header"
    );
    assert.ok(
      ocrResultCardSrc.includes("SF2 Daily Attendance &amp; Shading Pattern Classifier") ||
      ocrResultCardSrc.includes("SF2 Daily Attendance & Shading Pattern Classifier"),
      "SF2 must render SF2 Daily Attendance Grid"
    );

    // 6c. SF9 Progress Report: Learner Identity + Attendance (Front) + Grades & Observed Values (Back)
    assert.ok(
      ocrResultCardSrc.includes("Learner Identity & Form Details (SF9-SHS)") ||
      ocrResultCardSrc.includes("Learner Identity &amp; Form Details (SF9-SHS)"),
      "SF9 must render Learner Identity & Form Details header"
    );
    assert.ok(
      ocrResultCardSrc.includes("isSf9 && Array.isArray(fields.attendance)"),
      "SF9 Front must render Attendance Summary"
    );
    assert.ok(
      ocrResultCardSrc.includes("isSf9 && fields.observed_values"),
      "SF9 Back must render Report on Learner's Observed Values"
    );
    assert.ok(
      ocrResultCardSrc.includes("isSf9 && (fields.learner_progress_achievement || fields.grading_scale)"),
      "SF9 Back must render Grading Scale Legend"
    );

    // 6d. SF10 Permanent Record: Permanent Record Identity + Scholastic Subject Grades
    assert.ok(
      ocrResultCardSrc.includes("Learner Permanent Record Identity (SF10-SHS)"),
      "SF10 must render Learner Permanent Record Identity header"
    );
    // SF10 excludes SF9 attendance summary and observed values
    assert.ok(
      !ocrResultCardSrc.includes("isSf10 && Array.isArray(fields.attendance)"),
      "SF10 must not render SF9 monthly attendance summary"
    );
    assert.ok(
      !ocrResultCardSrc.includes("isSf10 && fields.observed_values"),
      "SF10 must not render SF9 observed values matrix"
    );
  });

  test("7. DocumentTable and Document Registry preserve clean PSA presentation without place_of_birth", () => {
    assert.strictEqual(
      docTableSrc.includes("place_of_birth"),
      false,
      "DocumentTable must not include place_of_birth"
    );
    assert.strictEqual(
      docTableSrc.includes("Place of Birth"),
      false,
      "DocumentTable must not include Place of Birth"
    );
  });
});

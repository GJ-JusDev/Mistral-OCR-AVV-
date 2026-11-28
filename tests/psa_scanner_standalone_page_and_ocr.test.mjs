import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

describe("AVV System — Standalone PSA Scanner & OCR Verification Suite", async () => {
  const { parsePsaBirthCert, extractPsaSexFromMarkPlacement } = await import("../src/lib/ocr/psaParser.ts");
  const { comparePsaAndSf1 } = await import("../src/lib/validation/crossDocumentEngine.ts");

  test("1. PSA-only page loads without requiring other documents", () => {
    // Check that /psa-scan page exists and is independent
    const pagePath = path.join(rootDir, "src", "app", "psa-scan", "page.tsx");
    assert.ok(fs.existsSync(pagePath), "src/app/psa-scan/page.tsx must exist");

    const pageContent = fs.readFileSync(pagePath, "utf8");
    // Standalone page must not require SF1, SF2, SF9, or SF10 to scan
    assert.ok(!pageContent.includes("requireSf1"), "Must not require SF1");
    assert.ok(!pageContent.includes("requireSf2"), "Must not require SF2");
    assert.ok(!pageContent.includes("requireSf9"), "Must not require SF9");
    assert.ok(!pageContent.includes("requireSf10"), "Must not require SF10");

    // Sidebar navigation check
    const sidebarPath = path.join(rootDir, "src", "components", "layout", "Sidebar.tsx");
    const sidebarContent = fs.readFileSync(sidebarPath, "utf8");
    assert.ok(
      sidebarContent.includes('name: "PSA Scanner", href: "/psa-scan"'),
      "Teacher navigation must contain 'PSA Scanner' linking to '/psa-scan'"
    );
  });

  test("2. Image upload and preview support", () => {
    const pagePath = path.join(rootDir, "src", "app", "psa-scan", "page.tsx");
    const content = fs.readFileSync(pagePath, "utf8");

    // Supports JPG, PNG, PDF formats
    assert.ok(content.includes("image/jpeg") && content.includes("application/pdf"), "Must support JPG/PNG and PDF");

    // Image preview and camera capture integration
    assert.ok(content.includes("DocumentCameraCaptureModal"), "Must integrate DocumentCameraCaptureModal");
    assert.ok(content.includes("handleRemoveFile"), "Must support removing uploaded file");
    assert.ok(content.includes("Replace"), "Must support replacing uploaded file");
    assert.ok(content.includes("previewDataUrl"), "Must provide image preview");
  });

  test("3. PSA OCR processing API and orchestration", () => {
    const apiRoutePath = path.join(rootDir, "src", "app", "api", "scan", "psa", "route.ts");
    assert.ok(fs.existsSync(apiRoutePath), "API route /api/scan/psa must exist");

    const routeContent = fs.readFileSync(apiRoutePath, "utf8");
    assert.ok(routeContent.includes("OcrOrchestrator"), "Must reuse OcrOrchestrator");
    assert.ok(routeContent.includes("parsePsaBirthCert"), "Must reuse parsePsaBirthCert");
    assert.ok(routeContent.includes("test_mode: true"), "Must identify test_mode");
  });

  test("4. Child's complete name extraction", () => {
    const sampleText = `
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      Registry No. 2008-00543
      1. NAME: DELA CRUZ, CARLOS MIGUEL
      2. SEX: MALE
      3. DATE OF BIRTH: 15 MARCH 2008
      4. PLACE OF BIRTH: San Jose, Batangas
      MOTHER MAIDEN NAME: MARIA LOURDES SANTOS
      FATHER NAME: ANTONIO DELA CRUZ
    `;

    const res = parsePsaBirthCert(sampleText);
    assert.ok(res.identity.complete_name, "Child complete name must be extracted");
    assert.ok(
      res.identity.complete_name.includes("Carlos") && res.identity.complete_name.includes("Dela Cruz"),
      `Expected complete name with Carlos and Dela Cruz, got: ${res.identity.complete_name}`
    );
    assert.strictEqual(res.field_statuses.complete_name.status, "extracted");
  });

  test("5. First, Middle, and Last Name extraction", () => {
    const separateLinesText = `
      CERTIFICATE OF LIVE BIRTH
      Registry No. 2007-88991
      First Name: Carlos
      Middle Name: Miguel
      Last Name: Dela Cruz
      Date of Birth: 14 August 2007
      Sex: Male
      Place of Birth: Taysan, Batangas
    `;

    const res = parsePsaBirthCert(separateLinesText);
    assert.strictEqual(res.identity.first_name, "Carlos");
    assert.strictEqual(res.identity.middle_name, "Miguel");
    assert.strictEqual(res.identity.last_name, "Dela Cruz");
    assert.strictEqual(res.identity.complete_name, "Carlos Miguel Dela Cruz");
    assert.strictEqual(res.field_statuses.first_name.status, "extracted");
    assert.strictEqual(res.field_statuses.middle_name.status, "extracted");
    assert.strictEqual(res.field_statuses.last_name.status, "extracted");
  });

  test("6. Missing middle name handled without error", () => {
    const noMiddleText = `
      CERTIFICATE OF LIVE BIRTH
      Registry No. 2007-88992
      First Name: Carlos
      Last Name: Dela Cruz
      Date of Birth: 14 August 2007
      Sex: Male
    `;

    const res = parsePsaBirthCert(noMiddleText);
    assert.strictEqual(res.identity.first_name, "Carlos");
    assert.strictEqual(res.identity.last_name, "Dela Cruz");
    assert.strictEqual(res.identity.middle_name, undefined);
    assert.strictEqual(res.identity.complete_name, "Carlos Dela Cruz");
    assert.strictEqual(res.field_statuses.middle_name.status, "not_detected");
    assert.strictEqual(res.field_statuses.complete_name.status, "extracted");
  });

  test("7. Unreadable child name flagged as not detected and needs verification", () => {
    const unreadableText = `
      REPUBLIC OF THE PHILIPPINES
      CERTIFICATE OF LIVE BIRTH
      Registry No. 2007-99999
      Random unreadable blurred line without valid child field
      Date of Birth: 14 August 2007
      Sex: Female
    `;

    const res = parsePsaBirthCert(unreadableText);
    assert.strictEqual(res.identity.complete_name, undefined);
    assert.strictEqual(res.field_statuses.complete_name.status, "not_detected");
    assert.ok(
      res.warnings.some((w) => w.toLowerCase().includes("child complete name")),
      "Must record warning about child complete name"
    );
  });

  test("8. Date of Birth extraction (Flexible formats and no invented fallback)", () => {
    const dateText1 = `
      CERTIFICATE OF LIVE BIRTH
      CHILD: Juan Dela Cruz
      DATE OF BIRTH: 15 June 2009
      SEX: MALE
    `;
    const res1 = parsePsaBirthCert(dateText1);
    assert.strictEqual(res1.identity.birth_date, "2009-06-15");
    assert.strictEqual(res1.field_statuses.birth_date.status, "extracted");

    // Missing DOB: must NOT invent 2009-01-01
    const missingDobText = `
      CERTIFICATE OF LIVE BIRTH
      CHILD: Juan Dela Cruz
      SEX: MALE
    `;
    const res2 = parsePsaBirthCert(missingDobText);
    assert.strictEqual(res2.identity.birth_date, "");
    assert.strictEqual(res2.field_statuses.birth_date.status, "not_detected");
    assert.ok(
      res2.warnings.some((w) => w.toLowerCase().includes("date of birth")),
      "Must warn about missing date of birth"
    );
  });

  test("9. Mother's and Father's complete name extraction", () => {
    const sampleText = `
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      CHILD: Juan Dela Cruz
      MOTHER'S MAIDEN NAME: MARIA CLARA SANTOS
      FATHER'S NAME: PEDRO DELA CRUZ
    `;

    const res = parsePsaBirthCert(sampleText);
    assert.ok(res.identity.mother_maiden_name?.includes("SANTOS"));
    assert.ok(res.identity.father_name?.includes("DELA CRUZ"));
    assert.strictEqual(res.field_statuses.mother_name.status, "extracted");
    assert.strictEqual(res.field_statuses.father_name.status, "extracted");
  });

  test("10. Manual correction interface and state update", () => {
    const pagePath = path.join(rootDir, "src", "app", "psa-scan", "page.tsx");
    const content = fs.readFileSync(pagePath, "utf8");

    assert.ok(content.includes("handleSaveCorrections"), "Must support saving manual corrections");
    assert.ok(content.includes("handleFieldChange"), "Must support editing individual fields");
    assert.ok(content.includes("handleRevertToOcr"), "Must support reverting to OCR extracted values");
    assert.ok(content.includes("Manually Corrected by Teacher"), "Must display manual correction indicator");
  });

  test("11. No automatic student creation in test mode", () => {
    const apiRoutePath = path.join(rootDir, "src", "app", "api", "scan", "psa", "route.ts");
    const routeContent = fs.readFileSync(apiRoutePath, "utf8");

    // Must not insert into students table
    assert.ok(!routeContent.includes(".from('students').insert"), "Must not insert into students table");
    assert.ok(!routeContent.includes('.from("students").insert'), "Must not insert into students table");
    assert.ok(!routeContent.includes(".from('students').upsert"), "Must not upsert into students table");
    assert.ok(!routeContent.includes('.from("students").upsert'), "Must not upsert into students table");
  });

  test("12. No automatic identity overwrite in test mode", () => {
    const pagePath = path.join(rootDir, "src", "app", "psa-scan", "page.tsx");
    const pageContent = fs.readFileSync(pagePath, "utf8");

    // Must be preview only
    assert.ok(pageContent.includes("PREVIEW ONLY"), "Must declare preview only");
    assert.ok(!pageContent.includes("updateStudent"), "Must not update student identity");
    assert.ok(!pageContent.includes("mergeStudent"), "Must not automatically merge student records");

    // Test crossDocument comparison utility directly
    const psa = { last_name: "DELA CRUZ", first_name: "CARLOS", middle_name: "MIGUEL" };
    const sf1 = { last_name: "DELA CRUZ", first_name: "CARLOS", middle_name: "MIGUEL" };
    const cmp = comparePsaAndSf1(psa, sf1);
    assert.strictEqual(cmp.status, "MATCH");
  });

  test("13. No unauthorized Admin or Principal scanning", () => {
    const middlewarePath = path.join(rootDir, "src", "middleware.ts");
    const middlewareContent = fs.readFileSync(middlewarePath, "utf8");

    // Middleware blocks Principal from /psa-scan
    assert.ok(
      middlewareContent.includes("pathname.startsWith('/psa-scan')"),
      "Middleware must protect /psa-scan"
    );
    assert.ok(
      middlewareContent.includes("role === 'principal' && (pathname.startsWith('/upload') || pathname.startsWith('/review') || pathname.startsWith('/psa-scan'))"),
      "Principal must be blocked from /psa-scan"
    );
    assert.ok(
      middlewareContent.includes("pathname.startsWith('/psa-scan')") &&
      middlewareContent.includes("role === 'admin'"),
      "Admin must be blocked from /psa-scan"
    );

    // API route blocks Admin and Principal
    const apiRoutePath = path.join(rootDir, "src", "app", "api", "scan", "psa", "route.ts");
    const routeContent = fs.readFileSync(apiRoutePath, "utf8");
    assert.ok(routeContent.includes("ADMIN_CANNOT_SCAN"), "API route must return ADMIN_CANNOT_SCAN for Admin");
    assert.ok(routeContent.includes("PRINCIPAL_READ_ONLY"), "API route must return PRINCIPAL_READ_ONLY for Principal");

    // Sidebar navigation exclusion
    const sidebarPath = path.join(rootDir, "src", "components", "layout", "Sidebar.tsx");
    const sidebarContent = fs.readFileSync(sidebarPath, "utf8");
    const adminNavMatch = sidebarContent.match(/const adminNavigation = \[([\s\S]*?)\];/);
    const principalNavMatch = sidebarContent.match(/const principalNavigation = \[([\s\S]*?)\];/);
    assert.ok(!adminNavMatch[1].includes("/psa-scan"), "Admin sidebar must NOT contain PSA Scanner");
    assert.ok(!principalNavMatch[1].includes("/psa-scan"), "Principal sidebar must NOT contain PSA Scanner");
  });

  test("14. No accidental production database or storage writes in test mode", () => {
    const apiRoutePath = path.join(rootDir, "src", "app", "api", "scan", "psa", "route.ts");
    const routeContent = fs.readFileSync(apiRoutePath, "utf8");

    // Zero storage upload calls
    assert.ok(!routeContent.includes(".storage.from("), "Must not write to Supabase storage");
    assert.ok(!routeContent.includes(".from('documents').insert"), "Must not insert into documents table");
    assert.ok(!routeContent.includes('.from("documents").insert'), "Must not insert into documents table");
    assert.ok(!routeContent.includes(".from('psa_identity_records').insert"), "Must not insert into psa_identity_records table");
    assert.ok(!routeContent.includes('.from("psa_identity_records").insert'), "Must not insert into psa_identity_records table");
  });

  test("15. Existing upload wizard and batch workflow remain unaffected", () => {
    const wizardPath = path.join(rootDir, "src", "app", "upload", "page.tsx");
    const wizardContent = fs.readFileSync(wizardPath, "utf8");

    // Check wizard steps are intact
    assert.ok(wizardContent.includes("WIZARD_STEPS"), "Upload wizard steps must remain intact");
    assert.ok(wizardContent.includes("SF1-SHS"), "SF1 step must be intact");
    assert.ok(wizardContent.includes("SF2-SHS"), "SF2 step must be intact");
    assert.ok(wizardContent.includes("SF9-SHS"), "SF9 step must be intact");
    assert.ok(wizardContent.includes("sf5") || wizardContent.includes("SF5"), "SF5 support must be intact");

    // Batch scan route intact
    const batchRoutePath = path.join(rootDir, "src", "app", "api", "scan", "batch", "route.ts");
    assert.ok(fs.existsSync(batchRoutePath), "Batch scan API route must remain intact");
  });

  test("16. Multiline Azure prebuilt-read OCR parsing with typo resilience and upper-section crop", () => {
    // Synthetic fixture with Azure prebuilt-read quirks:
    // - Header noise interleaved ("Chy/Municipality", "Province")
    // - Item 1 multiline with "(LAM)" OCR typo for "(Last)"
    // - Item 2 with "X_1 Mal" checkbox and "2 Female"
    // - Item 6 Mother with multiline names and missing "(Last)" label before Item 7
    // - Item 13 Father with multiline names and missing "(Last)" label before Item 14
    // - Multi-part Registry No with dot ("204. 52545")
    const syntheticAzureOcrText = `
      REPUBLIC OF THE PHILIPPINES
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      Registry No. 204. 52545
      Province: Batangas
      Chy/Municipality: San Jose
      1. NAME
      (First)
      JUAN
      (Middle)
      SANTOS
      (LAM)
      DELA CRUZ
      2. SEX
      X_1 Mal
      2 Female
      3. DATE OF BIRTH
      (Day) 15 (Month) AUGUST (Year) 2007
      4. PLACE OF BIRTH
      San Jose District Hospital, San Jose, Batangas
      6. MAIDEN NAME
      (First)
      MARIA
      (Middle)
      LOURDES
      REYES
      7. CITIZENSHIP
      Filipino
      8. RELIGION
      Roman Catholic
      13. NAME
      (First)
      ANTONIO
      (Middle)
      SANTOS
      DELA CRUZ
      14. CITIZENSHIP
      Filipino
      15. RELIGION
      Roman Catholic
    `;

    const res = parsePsaBirthCert(syntheticAzureOcrText);

    // Child Name: header noise rejected, (LAM) typo parsed as Last Name
    assert.strictEqual(res.identity.first_name, "Juan");
    assert.strictEqual(res.identity.middle_name, "Santos");
    assert.strictEqual(res.identity.last_name, "Dela Cruz");
    assert.strictEqual(res.identity.complete_name, "Juan Santos Dela Cruz");
    assert.strictEqual(res.field_statuses.complete_name.status, "extracted");
    assert.strictEqual(res.field_statuses.first_name.status, "extracted");
    assert.strictEqual(res.field_statuses.last_name.status, "extracted");

    // Sex: "X_1 Mal" extracted as "M" without falsely defaulting to Female
    assert.strictEqual(res.identity.sex, "M");
    assert.strictEqual(res.field_statuses.sex.status, "extracted");

    // DOB: 15 August 2007 -> 2007-08-15
    assert.strictEqual(res.identity.birth_date, "2007-08-15");
    assert.strictEqual(res.field_statuses.birth_date.status, "extracted");

    // Mother: multiline without (Last) label extracted before Item 7
    assert.match(res.identity.mother_maiden_name, /Maria/i);
    assert.match(res.identity.mother_maiden_name, /Reyes/i);
    assert.strictEqual(res.field_statuses.mother_name.status, "extracted");

    // Father: multiline without (Last) label extracted before Item 14
    assert.match(res.identity.father_name, /Antonio/i);
    assert.match(res.identity.father_name, /Dela Cruz/i);
    assert.strictEqual(res.field_statuses.father_name.status, "extracted");

    // Registry No: "204. 52545" normalized to "204-52545"
    assert.strictEqual(res.identity.registry_number, "204-52545");
    assert.strictEqual(res.field_statuses.registry_number.status, "extracted");

    // Upper section crop priority option
    const upperSectionText = `
      Registry No. 204-52545
      1. NAME (First) JUAN (Middle) SANTOS (Last) DELA CRUZ
      2. SEX 1 Male 2 Female
      3. DATE OF BIRTH 2007-08-15
      6. MAIDEN NAME MARIA REYES
      13. NAME ANTONIO DELA CRUZ
    `;
    const resWithUpper = parsePsaBirthCert(syntheticAzureOcrText, undefined, 0.95, {
      upperSectionText,
    });
    assert.strictEqual(resWithUpper.identity.complete_name, "Juan Santos Dela Cruz");
    assert.strictEqual(resWithUpper.identity.registry_number, "204-52545");
  });

  test("17. Label typo resilience, missing (Last) label multiline layout, multiline checkmark with Malo typo, and multiline DOB extraction", () => {
    const syntheticMultilineOcr = `
REPUBLIC OF THE PHILIPPINES
OFFICE OF THE CIVIL REGISTRAR GENERAL
CERTIFICATE OF LIVE BIRTH
Registry No. 2004-98765

1. NAME
(First)
GABRIEL
(Middla)
VALDEZ
MENDOZA
2. SEX
x
1 Malo
2 Female
3. DATE OF BIRTH
23
JUNE 2004
4. PLACE OF BIRTH QUEZON CITY
6. MAIDEN NAME CARMEN VALDEZ
13. NAME EDUARDO MENDOZA
`;
    const res = parsePsaBirthCert(syntheticMultilineOcr);

    // Child name: (Middla) typo recognized as structural label, missing (Last) label does not drop last name
    assert.strictEqual(res.identity.first_name, "Gabriel");
    assert.strictEqual(res.identity.middle_name, "Valdez");
    assert.strictEqual(res.identity.last_name, "Mendoza");
    assert.strictEqual(res.identity.complete_name, "Gabriel Valdez Mendoza");
    assert.strictEqual(res.field_statuses.first_name.status, "extracted");
    assert.strictEqual(res.field_statuses.middle_name.status, "extracted");
    assert.strictEqual(res.field_statuses.last_name.status, "extracted");
    assert.strictEqual(res.field_statuses.complete_name.status, "extracted");

    // Sex: "x" preceding "1 Malo" extracted as "M" with "extracted" status
    assert.strictEqual(res.identity.sex, "M");
    assert.strictEqual(res.field_statuses.sex.status, "extracted");

    // DOB: multiline "23\nJUNE 2004" extracted as "2004-06-23" with "extracted" status
    assert.strictEqual(res.identity.birth_date, "2004-06-23");
    assert.strictEqual(res.field_statuses.birth_date.status, "extracted");
  });

  test("18. Strips leading (Last) OCR typo 'Lan' from Last Name and prioritizes upperSection score 4 candidate", () => {
    const rawDocText = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
Registry No. 2003-12345
1. NAME
(First)
JUSTIN
(Middla)
LOQUILLANO
Lan GOMEZ
2. SEX
x
1 Malo
2 Female
3. DATE OF BIRTH
29 DECEMBER 2003
4. PLACE OF BIRTH QUEZON CITY
6. MAIDEN NAME MARIA LOQUILLANO
13. NAME JUAN GOMEZ
`;

    const upperSectionText = `
1. NAME
(First)
JUSTIN
(Middla)
LOQUILLANO
Lan GOMEZ
2. SEX
x
1 Malo
2 Female
3. DATE OF BIRTH
29 DECEMBER 2003
4. PLACE OF BIRTH QUEZON CITY
`;

    // Even if tight childNameCrop includes the unparenthesized "Lan" typo
    const childNameText = `
JUSTIN
LOQUILLANO
Lan GOMEZ
`;

    const res = parsePsaBirthCert(rawDocText, {
      upperSectionText,
      childNameText,
    });

    // 1. Last name must cleanly be "Gomez", without the "Lan" label typo
    assert.strictEqual(res.identity.first_name, "Justin");
    assert.strictEqual(res.identity.middle_name, "Loquillano");
    assert.strictEqual(res.identity.last_name, "Gomez");
    assert.strictEqual(res.identity.complete_name, "Justin Loquillano Gomez");
    assert.strictEqual(res.field_statuses.first_name.status, "extracted");
    assert.strictEqual(res.field_statuses.middle_name.status, "extracted");
    assert.strictEqual(res.field_statuses.last_name.status, "extracted");
    assert.strictEqual(res.field_statuses.complete_name.status, "extracted");

    // 2. Multiline checkmark before "1 Malo" correctly extracts Sex "M"
    // and is NOT overwritten by childNameCrop which lacks Item 2
    assert.strictEqual(res.identity.sex, "M");
    assert.strictEqual(res.field_statuses.sex.status, "extracted");
    assert.strictEqual(res.identity.birth_date, "2003-12-29");
  });

  test("19. Multiline checkmark detection for Female with 'v' or '✓' checkmark", () => {
    const femaleDocText = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME
(First)
SARAH
(Middle)
SANTOS
(Last)
REYES
2. SEX
1 Male
v
2 Female
3. DATE OF BIRTH
15 MAY 2005
`;
    const res = parsePsaBirthCert(femaleDocText);
    assert.strictEqual(res.identity.first_name, "Sarah");
    assert.strictEqual(res.identity.middle_name, "Santos");
    assert.strictEqual(res.identity.last_name, "Reyes");
    assert.strictEqual(res.identity.sex, "F");
    assert.strictEqual(res.field_statuses.sex.status, "extracted");
  });

  test("20. Honest per-field confidence percentages (0-100) and missing field confidence set to 0", () => {
    const completeDocText = `
REPUBLIC OF THE PHILIPPINES
OFFICE OF THE CIVIL REGISTRAR GENERAL
CERTIFICATE OF LIVE BIRTH
Registry No. 2004-98765

1. NAME
(First)
GABRIEL
(Middle)
VALDEZ
(Last)
MENDOZA
2. SEX
x 1 Male
2 Female
3. DATE OF BIRTH
23 JUNE 2004
4. PLACE OF BIRTH QUEZON CITY
6. MAIDEN NAME CARMEN VALDEZ
13. NAME EDUARDO MENDOZA
`;
    const res = parsePsaBirthCert(completeDocText, undefined, 0.94);

    const requiredFields = [
      "first_name",
      "middle_name",
      "last_name",
      "birth_date",
      "sex",
      "mother_name",
      "father_name",
      "registry_number",
    ];

    for (const field of requiredFields) {
      const fieldItem = res.field_statuses[field];
      assert.ok(fieldItem, `field_statuses must include ${field}`);
      assert.strictEqual(typeof fieldItem.confidence, "number", `${field} confidence must be a number`);
      assert.ok(Number.isInteger(fieldItem.confidence), `${field} confidence must be an integer`);
      assert.ok(fieldItem.confidence >= 85 && fieldItem.confidence <= 100, `${field} confidence must be between 85 and 100 for extracted fields`);
    }

    // Document with missing middle name and missing father name
    const missingFieldsDocText = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
Registry No. 2004-98765

1. NAME
(First)
GABRIEL
(Last)
MENDOZA
2. SEX
1 Male [x]
3. DATE OF BIRTH
23 JUNE 2004
6. MAIDEN NAME CARMEN VALDEZ
`;
    const resMissing = parsePsaBirthCert(missingFieldsDocText, undefined, 0.94);

    // Missing middle name: status not_detected, confidence strictly 0
    assert.strictEqual(resMissing.field_statuses.middle_name.status, "not_detected");
    assert.strictEqual(resMissing.field_statuses.middle_name.confidence, 0);

    // Missing father name: status not_detected, confidence strictly 0
    assert.strictEqual(resMissing.field_statuses.father_name.status, "not_detected");
    assert.strictEqual(resMissing.field_statuses.father_name.confidence, 0);

    // Present fields have >= 85% confidence
    assert.strictEqual(resMissing.field_statuses.first_name.status, "extracted");
    assert.ok(resMissing.field_statuses.first_name.confidence >= 85);
    assert.strictEqual(resMissing.field_statuses.last_name.status, "extracted");
    assert.ok(resMissing.field_statuses.last_name.confidence >= 85);
  });

  test("21. PSA Item 2. SEX multi-line above-underline and bounding-box spatial mark extraction", () => {
    // Multi-line text: '2. SEX X' on line 1, '1 Male 2 Female' on line 2
    const multiLineMale = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN GOMEZ
2. SEX X
1 Male    2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
    const resMale = parsePsaBirthCert(multiLineMale);
    assert.strictEqual(resMale.identity.sex, "M");
    assert.strictEqual(resMale.identity.sex_label, "Male");
    assert.ok(resMale.field_statuses.sex.confidence >= 85);

    // Multi-line text with standalone mark on its own line: 'X'
    const standaloneMark = `
2. SEX
X
1 Male    2 Female
`;
    const resStandalone = parsePsaBirthCert(standaloneMark);
    assert.strictEqual(resStandalone.identity.sex, "M");
    assert.strictEqual(resStandalone.identity.sex_label, "Male");
    assert.ok(resStandalone.field_statuses.sex.confidence >= 85);

    // Markdown table cells: | 2. SEX | X 1 Male 2 Female |
    const tableCell = `
| 2. SEX | X 1 Male 2 Female |
`;
    const resTableCell = parsePsaBirthCert(tableCell);
    assert.strictEqual(resTableCell.identity.sex, "M");
    assert.strictEqual(resTableCell.identity.sex_label, "Male");
    assert.ok(resTableCell.field_statuses.sex.confidence >= 85);

    // Bounding-box spatial offset: mark sits above 1 Male vs 2 Female
    const wordsMale = [
      { text: "2. SEX", polygon: [100, 200, 200, 200, 200, 220, 100, 220] },
      { text: "X", polygon: [80, 250, 95, 250, 95, 270, 80, 270] },
      { text: "1 Male", polygon: [100, 290, 160, 290, 160, 310, 100, 310] },
      { text: "2 Female", polygon: [200, 290, 280, 290, 280, 310, 200, 310] },
    ];
    const spatialMale = extractPsaSexFromMarkPlacement("2. SEX\n1 Male 2 Female", wordsMale);
    assert.strictEqual(spatialMale.sex, "M");
    assert.strictEqual(spatialMale.sexLabel, "Male");
    assert.ok(spatialMale.confidence >= 85);

    const wordsFemale = [
      { text: "2. SEX", polygon: [100, 200, 200, 200, 200, 220, 100, 220] },
      { text: "X", polygon: [210, 250, 225, 250, 225, 270, 210, 270] },
      { text: "1 Male", polygon: [100, 290, 160, 290, 160, 310, 100, 310] },
      { text: "2 Female", polygon: [200, 290, 280, 290, 280, 310, 200, 310] },
    ];
    const spatialFemale = extractPsaSexFromMarkPlacement("2. SEX\n1 Male 2 Female", wordsFemale);
    assert.strictEqual(spatialFemale.sex, "F");
    assert.strictEqual(spatialFemale.sexLabel, "Female");
    assert.ok(spatialFemale.confidence >= 85);
  });

  test("22. PSA Item 2. SEX pixel ink density comparison (Left '1 Male' box vs Right '2 Female' box) via sharp", async () => {
    const sharp = (await import("sharp")).default;
    const { detectPsaSexFromMarkBoxInk, parsePsaCertificate } = await import("../src/lib/ocr/psaParser.ts");

    // Standard Municipal Form No. 102 Upper Section (1-17) dimensions: 1000 x 1400 px
    const imgWidth = 1000;
    const imgHeight = 1400;

    // Word-polygon layout representing Azure OCR output with NO 'X' text token
    // (Simulates high-contrast B&W scan where typed X touched underline and was dropped by OCR)
    const azureRawLayoutNoX = {
      pages: [
        {
          width: imgWidth,
          height: imgHeight,
          words: [
            { content: "OFFICE", polygon: [350, 50, 450, 50, 450, 70, 350, 70] },
            { content: "CERTIFICATE", polygon: [300, 80, 500, 80, 500, 105, 300, 105] },
            { content: "1.", polygon: [50, 150, 65, 150, 65, 170, 50, 170] },
            { content: "NAME", polygon: [75, 150, 130, 150, 130, 170, 75, 170] },
            { content: "JUSTIN", polygon: [150, 150, 240, 150, 240, 170, 150, 170] },
            { content: "LOQUILLANO", polygon: [260, 150, 390, 150, 390, 170, 260, 170] },
            { content: "GOMEZ", polygon: [410, 150, 480, 150, 480, 170, 410, 170] },
            { content: "2.", polygon: [50, 220, 65, 220, 65, 240, 50, 240] },
            { content: "SEX", polygon: [70, 220, 110, 220, 110, 240, 70, 240] },
            { content: "1", polygon: [160, 220, 170, 220, 170, 240, 160, 240] },
            { content: "Male", polygon: [175, 220, 220, 220, 220, 240, 175, 240] },
            { content: "2", polygon: [280, 220, 290, 220, 290, 240, 280, 240] },
            { content: "Female", polygon: [295, 220, 360, 220, 360, 240, 295, 240] },
            { content: "3.", polygon: [450, 220, 465, 220, 465, 240, 450, 240] },
            { content: "DATE", polygon: [470, 220, 510, 220, 510, 240, 470, 240] },
            { content: "23", polygon: [550, 220, 570, 220, 570, 240, 550, 240] },
            { content: "JUNE", polygon: [580, 220, 620, 220, 620, 240, 580, 240] },
            { content: "2004", polygon: [630, 220, 670, 220, 670, 240, 630, 240] },
          ],
        },
      ],
    };

    const docTextWithoutX = `
Republic of the Philippines
OFFICE OF THE CIVIL REGISTRAR GENERAL
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN LOQUILLANO GOMEZ
2. SEX: 1 Male 2 Female
3. DATE OF BIRTH: 23 JUNE 2004
`;

    // ── Test A: Mark 'X' drawn inside the Left (Male) underline box ──
    // Left mark ROI spans: sexLabel.right (110) to maleAnchorLeft (160) - 2 -> x: 112..158, y: 215..235
    const maleSvg = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Bottom underlines -->
        <line x1="110" y1="239" x2="158" y2="239" stroke="black" stroke-width="2"/>
        <line x1="230" y1="239" x2="278" y2="239" stroke="black" stroke-width="2"/>
        <!-- Typed X in Left (Male) box touching underline -->
        <line x1="125" y1="218" x2="145" y2="238" stroke="black" stroke-width="4"/>
        <line x1="145" y1="218" x2="125" y2="238" stroke="black" stroke-width="4"/>
      </svg>
    `;
    const maleImgBuffer = await sharp(Buffer.from(maleSvg)).png().toBuffer();

    const maleInkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: maleImgBuffer,
      rawLayout: azureRawLayoutNoX,
    });

    assert.strictEqual(maleInkRes.sex, "Male", "Should detect Male from Left mark box ink");
    assert.ok(maleInkRes.confidence >= 90, `Male confidence should be >= 90%, got ${maleInkRes.confidence}`);
    assert.strictEqual(maleInkRes.source, "pixel_ink_left_box");
    assert.ok((maleInkRes.leftInkRatio || 0) > (maleInkRes.rightInkRatio || 0) * 1.55);

    // Assert parsePsaCertificate resolves Male with >= 90% confidence even with NO 'X' in text
    const maleCertRes = await parsePsaCertificate(docTextWithoutX, azureRawLayoutNoX, 0.95, {
      uprightImageBuffer: maleImgBuffer,
    });
    assert.strictEqual(maleCertRes.identity.sex, "M");
    assert.strictEqual(maleCertRes.identity.sex_label, "Male");
    assert.ok(maleCertRes.field_statuses.sex.confidence >= 90, "field_statuses.sex.confidence must be >= 90");
    assert.strictEqual(maleCertRes.field_statuses.sex.value, "Male");

    // ── Test B: Mark 'X' drawn inside the Right (Female) underline box ──
    // Right mark ROI spans: maleRight (220) + 4 to femaleAnchorLeft (280) - 2 -> x: 224..278, y: 215..235
    const femaleSvg = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Bottom underlines -->
        <line x1="110" y1="239" x2="158" y2="239" stroke="black" stroke-width="2"/>
        <line x1="230" y1="239" x2="278" y2="239" stroke="black" stroke-width="2"/>
        <!-- Typed X in Right (Female) box touching underline -->
        <line x1="242" y1="218" x2="262" y2="238" stroke="black" stroke-width="4"/>
        <line x1="262" y1="218" x2="242" y2="238" stroke="black" stroke-width="4"/>
      </svg>
    `;
    const femaleImgBuffer = await sharp(Buffer.from(femaleSvg)).png().toBuffer();

    const femaleInkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: femaleImgBuffer,
      rawLayout: azureRawLayoutNoX,
    });

    assert.strictEqual(femaleInkRes.sex, "Female", "Should detect Female from Right mark box ink");
    assert.ok(femaleInkRes.confidence >= 90, `Female confidence should be >= 90%, got ${femaleInkRes.confidence}`);
    assert.strictEqual(femaleInkRes.source, "pixel_ink_right_box");
    assert.ok((femaleInkRes.rightInkRatio || 0) > (femaleInkRes.leftInkRatio || 0) * 1.55);

    // Assert parsePsaCertificate resolves Female with >= 90% confidence
    const femaleCertRes = await parsePsaCertificate(docTextWithoutX, azureRawLayoutNoX, 0.95, {
      uprightImageBuffer: femaleImgBuffer,
    });
    assert.strictEqual(femaleCertRes.identity.sex, "F");
    assert.strictEqual(femaleCertRes.identity.sex_label, "Female");
    assert.ok(femaleCertRes.field_statuses.sex.confidence >= 90, "field_statuses.sex.confidence must be >= 90");
    assert.strictEqual(femaleCertRes.field_statuses.sex.value, "Female");
  });

  test("23. PSA Item 2. SEX pixel ink detection with merged line polygons and auto-trimmed white-margin scans", async () => {
    const sharp = (await import("sharp")).default;
    const { detectPsaSexFromMarkBoxInk, parsePsaCertificate } = await import("../src/lib/ocr/psaParser.ts");

    const imgWidth = 1000;
    const imgHeight = 1400;

    // ── Part A: Merged line polygon "2. SEX 1 Male 2 Female" (with NO 'X' token) + left-box ink detects "Male" (confidence >= 90) ──
    // Line bounding box: left: 100, top: 200, right: 600, bottom: 240 (width: 500, height: 40)
    // Left mark slot (1 Male): 100 + 500 * 0.18 = 190 to 100 + 500 * 0.48 = 340
    // Right mark slot (2 Female): 100 + 500 * 0.52 = 360 to 100 + 500 * 0.82 = 510
    const mergedLineRawLayout = {
      pages: [
        {
          width: imgWidth,
          height: imgHeight,
          lines: [
            {
              content: "2. SEX 1 Male 2 Female",
              polygon: [100, 200, 600, 200, 600, 240, 100, 240],
            },
          ],
          words: [], // NO individual Male or Female word polygons
        },
      ],
    };

    // Draw dark mark ('X') inside the Left slot (e.g. x: 235..265, y: 205..235)
    const mergedLineSvg = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Bottom underline for the line -->
        <line x1="100" y1="239" x2="600" y2="239" stroke="black" stroke-width="2"/>
        <!-- Typed X in Left (Male) mark slot (x: 235..265) -->
        <line x1="235" y1="205" x2="265" y2="235" stroke="black" stroke-width="4"/>
        <line x1="265" y1="205" x2="235" y2="235" stroke="black" stroke-width="4"/>
      </svg>
    `;
    const mergedLineImgBuf = await sharp(Buffer.from(mergedLineSvg)).png().toBuffer();

    const mergedInkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: mergedLineImgBuf,
      rawLayout: mergedLineRawLayout,
    });

    assert.strictEqual(mergedInkRes.sex, "Male", "Merged line polygon should detect Male from left-box ink");
    assert.ok(mergedInkRes.confidence >= 90, `Merged line Male confidence must be >= 90%, got ${mergedInkRes.confidence}`);
    assert.strictEqual(mergedInkRes.source, "pixel_ink_left_box");
    assert.ok((mergedInkRes.leftInkRatio || 0) > (mergedInkRes.rightInkRatio || 0) * 1.55);
    assert.ok(Array.isArray(mergedInkRes.matchedLines) && mergedInkRes.matchedLines.length > 0, "Should include matchedLines");

    // Also assert parsePsaCertificate with merged line layout resolves Male
    const docTextWithoutX = `
CERTIFICATE OF LIVE BIRTH
Registry No. 2004-1234
1. NAME: JUSTIN LOQUILLANO GOMEZ
2. SEX 1 Male 2 Female
3. DATE OF BIRTH: 23 JUNE 2004
`;
    const mergedCertRes = await parsePsaCertificate(docTextWithoutX, mergedLineRawLayout, 0.95, {
      uprightImageBuffer: mergedLineImgBuf,
    });
    assert.strictEqual(mergedCertRes.identity.sex, "M");
    assert.strictEqual(mergedCertRes.identity.sex_label, "Male");
    assert.ok(mergedCertRes.field_statuses.sex.confidence >= 90, "field_statuses.sex.confidence must be >= 90");
    assert.strictEqual(mergedCertRes.field_statuses.sex.value, "Male");

    // ── Part B: Centered PSA form surrounded by wide white margins (no rawLayout polygons) + left-box ink auto-trims white padding and detects "Male" (confidence >= 90) ──
    // Wide white margins: Total image 1000x1400. Form content box centered: left: 200, top: 200, width: 600, height: 1000
    // Inside form: Left slot is at 200 + 600 * 0.05 = 230 to 200 + 600 * 0.14 = 284
    // Top is at 200 + 1000 * 0.195 = 395 to 200 + 1000 * 0.235 = 435
    const centeredFormSvg = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Form outer border to establish trimmed bounding box -->
        <rect x="200" y="200" width="600" height="1000" fill="none" stroke="black" stroke-width="2"/>
        <!-- Form header line -->
        <line x1="220" y1="250" x2="780" y2="250" stroke="black" stroke-width="2"/>
        <!-- Typed X in Left (Male) slot of the centered form -->
        <line x1="245" y1="405" x2="265" y2="425" stroke="black" stroke-width="4"/>
        <line x1="265" y1="405" x2="245" y2="425" stroke="black" stroke-width="4"/>
      </svg>
    `;
    const centeredFormImgBuf = await sharp(Buffer.from(centeredFormSvg)).png().toBuffer();

    const centeredInkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: centeredFormImgBuf,
      // no rawLayout polygons
    });

    assert.strictEqual(centeredInkRes.sex, "Male", "Centered form with white margins should detect Male after auto-trim");
    assert.ok(centeredInkRes.confidence >= 90, `Centered form Male confidence must be >= 90%, got ${centeredInkRes.confidence}`);
    assert.strictEqual(centeredInkRes.source, "pixel_ink_left_box");
    assert.ok((centeredInkRes.leftInkRatio || 0) > (centeredInkRes.rightInkRatio || 0) * 1.55);

    // Also assert parsePsaCertificate with centered form image resolves Male
    const centeredCertRes = await parsePsaCertificate(docTextWithoutX, undefined, 0.95, {
      uprightImageBuffer: centeredFormImgBuf,
    });
    assert.strictEqual(centeredCertRes.identity.sex, "M");
    assert.strictEqual(centeredCertRes.identity.sex_label, "Male");
    assert.ok(centeredCertRes.field_statuses.sex.confidence >= 90, "Centered form field_statuses.sex.confidence must be >= 90");
    assert.strictEqual(centeredCertRes.field_statuses.sex.value, "Male");
  });

  test("24. PSA Item 2. SEX Right-Box Printed Label Contamination Prevention ('Female' False-Positive on Male Scan)", async () => {
    const sharp = (await import("sharp")).default;
    const { detectPsaSexFromMarkBoxInk } = await import("../src/lib/ocr/psaParser.ts");

    const imgWidth = 1000;
    const imgHeight = 1400;

    // Merged line polygon: "2. SEX 1 Male 2 Female"
    // line.left: 100, line.top: 200, line.width: 500, line.height: 40
    // Tightened Left slot: 100 + 500 * 0.18 = 190 to 100 + 500 * 0.44 = 320
    // Tightened Right slot: 100 + 500 * 0.44 = 320 to 100 + 500 * 0.60 = 400 (blank gap between "Male" and "2 Female")
    // Printed words "2 Female" and "3. DATE" exist on the right at x: 420..520 (line.width * 0.64..0.84)
    const mergedLineRawLayout = {
      pages: [
        {
          width: imgWidth,
          height: imgHeight,
          lines: [
            {
              content: "2. SEX 1 Male 2 Female",
              polygon: [100, 200, 600, 200, 600, 240, 100, 240],
            },
          ],
          words: [],
        },
      ],
    };

    // Draw Male 'X' mark inside left slot (x: 235..265),
    // and draw dark printed text pixels for "2 Female" in the right region (x: 420..490)
    const svgWithPrintedLabel = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Bottom underline for the line -->
        <line x1="100" y1="239" x2="600" y2="239" stroke="black" stroke-width="2"/>
        <!-- Typed 'X' in Left (Male) slot (x: 235..265) -->
        <line x1="235" y1="205" x2="265" y2="235" stroke="black" stroke-width="4"/>
        <line x1="265" y1="205" x2="235" y2="235" stroke="black" stroke-width="4"/>
        <!-- Printed text label "2 Female" located at x: 420..490 (outside the tightened 320..400 Right slot) -->
        <text x="425" y="225" font-family="sans-serif" font-size="20" font-weight="bold" fill="black">2 Female</text>
      </svg>
    `;

    const imgBuf = await sharp(Buffer.from(svgWithPrintedLabel)).png().toBuffer();

    const inkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: imgBuf,
      rawLayout: mergedLineRawLayout,
    });

    // The tightened Right ROI (320..400) excludes the printed text at x: 420+,
    // so rightInkRatio remains near 0 and does NOT trigger false "Female"!
    assert.strictEqual(inkRes.sex, "Male", "Should return Male and never Female when right printed label exists");
    assert.notStrictEqual(inkRes.sex, "Female", "Must NEVER return Female due to printed label ink");
    assert.strictEqual(inkRes.source, "pixel_ink_left_box");
    assert.ok(inkRes.confidence >= 90, "Male confidence must be >= 90%");
    assert.ok((inkRes.leftInkRatio || 0) > (inkRes.rightInkRatio || 0) * 1.55, "leftInkRatio must be > rightInkRatio * 1.55");
  });

  test("25. PSA Item 2. SEX Word-Polygon Mode Right ROI Tightening Before '2 Female' Printed Words", async () => {
    const sharp = (await import("sharp")).default;
    const { detectPsaSexFromMarkBoxInk } = await import("../src/lib/ocr/psaParser.ts");

    const imgWidth = 1000;
    const imgHeight = 1400;

    // Word polygons: "2." at x: 50..65, "SEX" at x: 70..110, "1" at x: 160..170, "Male" at x: 175..220, "2" at x: 280..290, "Female" at x: 295..360
    // Male mark slot is between "SEX" (110) and "1" (160): x: 110..158
    // Female mark slot is between "Male" (220) and "2" (280) -> right ROI ends strictly before "2" (280 - 4 = 276)
    const wordLayout = {
      pages: [
        {
          width: imgWidth,
          height: imgHeight,
          lines: [
            {
              content: "2. SEX 1 Male 2 Female",
              polygon: [50, 220, 360, 220, 360, 240, 50, 240],
            },
          ],
          words: [
            { content: "2.", polygon: [50, 220, 65, 220, 65, 240, 50, 240] },
            { content: "SEX", polygon: [70, 220, 110, 220, 110, 240, 70, 240] },
            { content: "1", polygon: [160, 220, 170, 220, 170, 240, 160, 240] },
            { content: "Male", polygon: [175, 220, 220, 220, 220, 240, 175, 240] },
            { content: "2", polygon: [280, 220, 290, 220, 290, 240, 280, 240] },
            { content: "Female", polygon: [295, 220, 360, 220, 360, 240, 295, 240] },
          ],
        },
      ],
    };

    // Draw Male 'X' mark inside left slot (x: 125..145)
    // and draw dark printed text pixels for "2" and "Female" at x: 282 and x: 300
    const svgContent = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <line x1="50" y1="239" x2="360" y2="239" stroke="black" stroke-width="2"/>
        <!-- Typed 'X' in Male mark slot (x: 125..145) -->
        <line x1="125" y1="215" x2="145" y2="235" stroke="black" stroke-width="4"/>
        <line x1="145" y1="215" x2="125" y2="235" stroke="black" stroke-width="4"/>
        <!-- Printed text '2' and 'Female' at x: 280+ -->
        <text x="282" y="235" font-family="sans-serif" font-size="18" font-weight="bold" fill="black">2</text>
        <text x="300" y="235" font-family="sans-serif" font-size="18" font-weight="bold" fill="black">Female</text>
      </svg>
    `;

    const imgBuf = await sharp(Buffer.from(svgContent)).png().toBuffer();

    const inkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: imgBuf,
      rawLayout: wordLayout,
    });

    assert.strictEqual(inkRes.sex, "Male", "Word polygon mode must detect Male and never Female");
    assert.strictEqual(inkRes.source, "pixel_ink_left_box");
    assert.ok(inkRes.confidence >= 90, "Male confidence must be >= 90%");
    assert.ok((inkRes.leftInkRatio || 0) > (inkRes.rightInkRatio || 0) * 1.55);
  });

  test("26. PSA Item 2. SEX Municipal Form No. 102 Geometry: '2. SEX' on line above 'X ___ 1 Male ___ 2 Female' (img_0007.png)", async () => {
    const sharp = (await import("sharp")).default;
    const { detectPsaSexFromMarkBoxInk, parsePsaCertificate } = await import("../src/lib/ocr/psaParser.ts");

    const imgWidth = 1000;
    const imgHeight = 1400;

    // Exact Municipal Form No. 102 geometry:
    // Line 1: '2.' and 'SEX' at y = 200..216, x = 60..135
    // Line 2: '1' (x: 120..130), 'Male' (x: 136..178), '2' (x: 252..262), 'Female' (x: 268..325) at y = 224..242
    // NO 'X' token in rawLayout words or lines!
    const wordLayout = {
      pages: [
        {
          width: imgWidth,
          height: imgHeight,
          lines: [
            {
              content: "2. SEX",
              polygon: [60, 200, 135, 200, 135, 216, 60, 216],
            },
            {
              content: "1 Male 2 Female",
              polygon: [120, 224, 325, 224, 325, 242, 120, 242],
            },
          ],
          words: [
            { content: "2.", polygon: [60, 200, 80, 200, 80, 216, 60, 216] },
            { content: "SEX", polygon: [85, 200, 135, 200, 135, 216, 85, 216] },
            { content: "1", polygon: [120, 224, 130, 224, 130, 242, 120, 242] },
            { content: "Male", polygon: [136, 224, 178, 224, 178, 242, 136, 242] },
            { content: "2", polygon: [252, 224, 262, 224, 262, 242, 252, 242] },
            { content: "Female", polygon: [268, 224, 325, 224, 325, 242, 268, 242] },
          ],
        },
      ],
    };

    // Render SVG with:
    // - Underlines at y = 241
    // - Typed 'X' at x: 75..105, y: 224..242 (directly below '2. SEX' and to the left of '1 Male')
    // - Printed digits and words '2' and 'Female' at x: 252+
    const svgContent = `
      <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Top line: 2. SEX -->
        <text x="60" y="214" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">2. SEX</text>
        <!-- Underline before 1 Male -->
        <line x1="70" y1="241" x2="115" y2="241" stroke="black" stroke-width="2"/>
        <!-- Underline before 2 Female -->
        <line x1="195" y1="241" x2="248" y2="241" stroke="black" stroke-width="2"/>
        <!-- Typed 'X' on Left Underline (x: 82..102, y: 225..239) -->
        <line x1="82" y1="225" x2="102" y2="239" stroke="black" stroke-width="3"/>
        <line x1="102" y1="225" x2="82" y2="239" stroke="black" stroke-width="3"/>
        <!-- Printed labels on Line 2 -->
        <text x="120" y="239" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">1</text>
        <text x="136" y="239" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">Male</text>
        <text x="252" y="239" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">2</text>
        <text x="268" y="239" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">Female</text>
      </svg>
    `;

    const imgBuf = await sharp(Buffer.from(svgContent)).png().toBuffer();

    const inkRes = await detectPsaSexFromMarkBoxInk({
      uprightImageBuffer: imgBuf,
      rawLayout: wordLayout,
    });

    assert.strictEqual(inkRes.sex, "Male", "Should detect Male from Left underline mark box ink on Municipal Form No. 102");
    assert.notStrictEqual(inkRes.sex, "Female", "Must NEVER return Female for Male scan with 2. SEX above 1 Male");
    assert.strictEqual(inkRes.source, "pixel_ink_left_box");
    assert.ok(inkRes.confidence >= 90, `Male confidence must be >= 90%, got ${inkRes.confidence}`);
    assert.ok((inkRes.leftInkRatio || 0) > (inkRes.rightInkRatio || 0) * 1.55, "leftInkRatio must be > rightInkRatio * 1.55");

    const docTextWithoutX = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN LOQUILLANO GOMEZ
2. SEX
1 Male 2 Female
3. DATE OF BIRTH: 23 JUNE 2004
`;

    const certRes = await parsePsaCertificate(docTextWithoutX, wordLayout, 0.95, {
      uprightImageBuffer: imgBuf,
    });

    assert.strictEqual(certRes.identity.sex, "M", "parsePsaCertificate must resolve sex to 'M'");
    assert.strictEqual(certRes.identity.sex_label, "Male", "parsePsaCertificate must resolve sex_label to 'Male'");
    assert.notStrictEqual(certRes.identity.sex, "F", "parsePsaCertificate must not resolve to 'F'");
    assert.ok(certRes.field_statuses.sex.confidence >= 90, "field_statuses.sex.confidence must be >= 90");
    assert.strictEqual(certRes.field_statuses.sex.value, "Male");
  });
});

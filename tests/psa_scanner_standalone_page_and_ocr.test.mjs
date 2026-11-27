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
});

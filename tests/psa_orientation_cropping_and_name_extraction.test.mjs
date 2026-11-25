import test from "node:test";
import assert from "node:assert/strict";

import {
  inspectPsaOrientation,
  rotatePixelBuffer,
  cropPixelBuffer,
  DEFAULT_PSA_CROP_REGIONS,
  preprocessPsaImage,
} from "../src/lib/ocr/psaPreprocessing.ts";
import {
  parsePsaBirthCert,
  isInvalidPersonName,
  extractPsaSections,
} from "../src/lib/ocr/psaParser.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { OcrProviderError } from "../src/lib/ocr/providers/types.ts";

test("AVV PSA — Orientation Correction, Targeted Cropping, and Name Extraction Suite", async (t) => {
  // =========================================================================
  // 1. ORIENTATION INSPECTION & ROTATION
  // =========================================================================

  await t.test("1.1 detects 90-degree clockwise rotated PSA image (landscape dimensions)", () => {
    // 90° clockwise scan of a portrait document has width > height
    const width = 1400;
    const height = 900;
    const inspection = inspectPsaOrientation(width, height);

    assert.strictEqual(inspection.isLandscape, true);
    assert.strictEqual(inspection.isUpright, false);
    assert.strictEqual(
      inspection.suggestedRotation,
      270,
      "Suggested rotation should be 270° clockwise (90° counter-clockwise)"
    );
  });

  await t.test("1.2 applies correct counter-clockwise orientation correction (270° CW / 90° CCW)", () => {
    // Synthetic landscape buffer: width = 20, height = 10
    const origW = 20;
    const origH = 10;
    const buf = new Uint8ClampedArray(origW * origH * 4);

    // Place a unique marker at top-left (0,0) in original
    buf[0] = 255;
    buf[1] = 0;
    buf[2] = 0;
    buf[3] = 255;

    // Rotate 270° CW (90° CCW): new dimensions must swap to upright portrait (10 x 20)
    const rotated = rotatePixelBuffer(buf, origW, origH, 270);

    assert.strictEqual(rotated.width, origH, "Width should become original height");
    assert.strictEqual(rotated.height, origW, "Height should become original width");
    assert.strictEqual(rotated.data.length, origH * origW * 4);

    // After 90° CCW rotation, original (0,0) moves to (0, newHeight - 1 - 0) = (0, 19)
    const dstIdx = (19 * rotated.width + 0) * 4;
    assert.strictEqual(rotated.data[dstIdx], 255, "Red pixel moved to correct rotated position");
  });

  await t.test("1.3 already-upright PSA image is NOT rotated (aspect ratio <= 1.0)", () => {
    const portraitW = 850;
    const portraitH = 1100;
    const inspection = inspectPsaOrientation(portraitW, portraitH);

    assert.strictEqual(inspection.isLandscape, false);
    assert.strictEqual(inspection.isUpright, true);
    assert.strictEqual(inspection.suggestedRotation, 0, "Upright image must have 0° rotation");

    // Pixel buffer rotation with 0° returns identical dimensions
    const buf = new Uint8ClampedArray(portraitW * portraitH * 4);
    const result = rotatePixelBuffer(buf, portraitW, portraitH, 0);
    assert.strictEqual(result.width, portraitW);
    assert.strictEqual(result.height, portraitH);
  });

  // =========================================================================
  // 2. TARGETED CHILD SECTION AND ITEM 1 CROPPING
  // =========================================================================

  await t.test("2.1 CHILD section crop covers Items 1 through 5 boundaries", () => {
    const region = DEFAULT_PSA_CROP_REGIONS.childSection;

    // Verifies vertical range covers Items 1-5 (approx 11% to 38%)
    assert.ok(region.top >= 0.08 && region.top <= 0.15, `Top bound ${region.top} should be near 11%`);
    assert.ok(region.bottom >= 0.32 && region.bottom <= 0.42, `Bottom bound ${region.bottom} should be near 38%`);
    assert.ok(region.left <= 0.05, "Left boundary captures full width with margins");
    assert.ok(region.right >= 0.95, "Right boundary captures full width with margins");

    // Crop execution on synthetic upright image (width = 1000, height = 1500)
    const w = 1000;
    const h = 1500;
    const buf = new Uint8ClampedArray(w * h * 4);
    const crop = cropPixelBuffer(buf, w, h, region);

    assert.strictEqual(crop.width, Math.round((region.right - region.left) * w));
    assert.strictEqual(crop.height, Math.round((region.bottom - region.top) * h));
  });

  await t.test("2.2 Item 1 name-only crop boundary focuses tightly on Name boxes", () => {
    const region = DEFAULT_PSA_CROP_REGIONS.childNameOnly;

    // Verifies tighter range (11% to 23%) specifically capturing Name boxes before Item 2 (Sex)
    assert.ok(region.top >= 0.08 && region.top <= 0.15);
    assert.ok(region.bottom >= 0.20 && region.bottom <= 0.26);
    assert.ok(region.bottom < DEFAULT_PSA_CROP_REGIONS.childSection.bottom);

    const w = 1000;
    const h = 1500;
    const buf = new Uint8ClampedArray(w * h * 4);
    const crop = cropPixelBuffer(buf, w, h, region);

    assert.strictEqual(crop.width, Math.round((region.right - region.left) * w));
    assert.strictEqual(crop.height, Math.round((region.bottom - region.top) * h));
  });

  await t.test("2.3 default upperIdentitySection crop cleanly frames Registry No. & Items 1-17 stopping before Item 18", () => {
    const region = DEFAULT_PSA_CROP_REGIONS.upperIdentitySection;
    assert.ok(region.top >= 0.02 && region.top <= 0.08, "top offset captures header and registry no");
    assert.ok(region.bottom >= 0.54 && region.bottom <= 0.60, "bottom offset stops right above Item 18 marriage");
    assert.ok(region.left >= 0.01 && region.left <= 0.06, "left margin accommodates scan margins");
    assert.ok(region.right <= 0.85, "right margin excludes right-side OCRG code boxes");
  });

  // =========================================================================
  // 3. CHILD COMPLETE NAME PARSING
  // =========================================================================

  await t.test("3.1 extracts first, middle, and last names printed on separate lines", () => {
    const text = `
REPUBLIC OF THE PHILIPPINES
OFFICE OF THE CIVIL REGISTRAR GENERAL
CERTIFICATE OF LIVE BIRTH
Registry No. 2003-88741

1. NAME
(First) MARIA ANGELA
(Middle) DELA MERCED
(Last) SANTOS

2. SEX Female
3. DATE OF BIRTH 29 December 2003
4. PLACE OF BIRTH St. Luke's Medical Center, Quezon City
`;
    const result = parsePsaBirthCert(text);

    assert.strictEqual(result.identity.first_name, "Maria Angela");
    assert.strictEqual(result.identity.middle_name, "Dela Merced");
    assert.strictEqual(result.identity.last_name, "Santos");
    assert.strictEqual(result.identity.complete_name, "Maria Angela Dela Merced Santos");
    assert.strictEqual(result.field_statuses.complete_name.status, "extracted");
    assert.strictEqual(result.field_statuses.first_name.status, "extracted");
    assert.strictEqual(result.field_statuses.last_name.status, "extracted");
  });

  await t.test("3.2 extracts a complete name printed on one single line", () => {
    const text = `
1. NAME (First, Middle, Last) JUAN REYES BAUTISTA
2. SEX Male
3. DATE OF BIRTH 14 August 2007
`;
    const result = parsePsaBirthCert(text);

    assert.strictEqual(result.identity.first_name, "Juan");
    assert.strictEqual(result.identity.middle_name, "Reyes");
    assert.strictEqual(result.identity.last_name, "Bautista");
    assert.match(result.identity.complete_name, /Juan Reyes Bautista/i);
    assert.strictEqual(result.field_statuses.complete_name.status, "extracted");
  });

  await t.test("3.2b preserves full complete name and marks ambiguous multi-token components for review", () => {
    const text = `
1. NAME (First, Middle, Last) JUAN CARLOS REYES BAUTISTA
2. SEX Male
3. DATE OF BIRTH 14 August 2007
`;
    const result = parsePsaBirthCert(text);

    assert.match(result.identity.complete_name, /Juan Carlos Reyes Bautista/i);
    assert.strictEqual(result.identity.last_name, "Bautista");
    assert.strictEqual(result.field_statuses.complete_name.status, "extracted");
  });

  await t.test("3.3 handles a missing middle name without error or invented value", () => {
    const text = `
1. NAME
(First) JANE
(Middle) NONE
(Last) DOE
2. SEX Female
3. DATE OF BIRTH 2005-06-15
`;
    const result = parsePsaBirthCert(text);

    assert.strictEqual(result.identity.first_name, "Jane");
    assert.strictEqual(result.identity.middle_name, undefined);
    assert.strictEqual(result.identity.last_name, "Doe");
    assert.strictEqual(result.identity.complete_name, "Jane Doe");
    assert.strictEqual(result.field_statuses.complete_name.status, "extracted");
  });

  await t.test("3.4 extracts child name from targeted Item 1 crop even if full document had noise", () => {
    const fullDocumentWithNoise = `
REPUBLIC OF THE PHILIPPINES
1. NAME (Unreadable sideways ink scan)
2. SEX Female
3. DATE OF BIRTH 2003-12-29
`;
    const targetedChildNameCropText = `
(First) CLARISSE JOY
(Middle) ALCANTARA
(Last) VILLANUEVA
`;
    const result = parsePsaBirthCert(fullDocumentWithNoise, undefined, 0.95, {
      childNameText: targetedChildNameCropText,
    });

    assert.strictEqual(result.identity.first_name, "Clarisse Joy");
    assert.strictEqual(result.identity.middle_name, "Alcantara");
    assert.strictEqual(result.identity.last_name, "Villanueva");
    assert.strictEqual(result.identity.complete_name, "Clarisse Joy Alcantara Villanueva");
    assert.strictEqual(result.identity.birth_date, "2003-12-29");
  });

  await t.test("3.5 extracts horizontal 3-column Child Name (JUSTIN LOQUILLANO GOMEZ), Sex (Male), and DOB with Form 102 labels without duplication", () => {
    const text = `
REPUBLIC OF THE PHILIPPINES
OFFICE OF THE CIVIL REGISTRAR GENERAL
CERTIFICATE OF LIVE BIRTH
Registry No. 2007-12345

1. NAME (First) (Middle) (Last)
JUSTIN LOQUILLANO GOMEZ

2. SEX 1 [x] Male   2 [ ] Female
3. DATE OF BIRTH (Day) 15 (Month) AUGUST (Year) 2007
4. PLACE OF BIRTH Manila Doctors Hospital, City of Manila
6. MAIDEN NAME MARIA SANTOS
13. NAME ROBERTO GOMEZ
`;
    const result = parsePsaBirthCert(text);

    assert.strictEqual(result.identity.first_name, "Justin");
    assert.strictEqual(result.identity.middle_name, "Loquillano");
    assert.strictEqual(result.identity.last_name, "Gomez");
    assert.strictEqual(result.identity.complete_name, "Justin Loquillano Gomez");
    assert.notStrictEqual(result.identity.complete_name, "Justin Justin");
    assert.strictEqual(result.identity.sex, "M");
    assert.strictEqual(result.identity.birth_date, "2007-08-15");
    assert.strictEqual(result.field_statuses.complete_name.status, "extracted");
    assert.strictEqual(result.field_statuses.sex.status, "extracted");
    assert.strictEqual(result.field_statuses.birth_date.status, "extracted");
  });

  // =========================================================================
  // 4. CROSS-SECTION ISOLATION & FATHER NAME INTEGRITY
  // =========================================================================

  await t.test("4.1 prevents MOTHER or FATHER names from being assigned to the child", () => {
    const text = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH

1. NAME (First, Middle, Last) BABY GIRL
2. SEX Female

6. MAIDEN NAME (First, Middle, Last) MARIA TERESA LOPEZ
7. CITIZENSHIP Filipino

13. NAME (First, Middle, Last) ROBERTO GONZALES
14. CITIZENSHIP Filipino
`;
    const result = parsePsaBirthCert(text);

    // Child name must NOT be taken from Mother or Father
    assert.notStrictEqual(result.identity.first_name, "Maria Teresa");
    assert.notStrictEqual(result.identity.last_name, "Lopez");
    assert.notStrictEqual(result.identity.first_name, "Roberto");
    assert.notStrictEqual(result.identity.last_name, "Gonzales");

    // Mother and Father are correctly assigned to their own fields
    assert.match(result.identity.mother_maiden_name, /Maria Teresa Lopez/i);
    assert.match(result.identity.father_name, /Roberto Gonzales/i);
  });

  await t.test("4.2 prevents city/municipality text ('RIN CAL. CITY') from being assigned to Father's Name", () => {
    const textWithAddressConfusion = `
REPUBLIC OF THE PHILIPPINES
1. NAME: SOFIA DEL MUNDO
2. SEX: Female
3. DATE OF BIRTH: 2003-12-29
4. PLACE OF BIRTH: HOSPITAL RIN CAL. CITY
6. MAIDEN NAME: ELENA BAUTISTA
12. RESIDENCE: 14 BARANGAY RIN CAL. CITY
13. NAME: RIN CAL. CITY
14. CITIZENSHIP: FILIPINO
`;
    // isInvalidPersonName must catch "RIN CAL. CITY"
    assert.strictEqual(isInvalidPersonName("RIN CAL. CITY"), true);
    assert.strictEqual(isInvalidPersonName("CALOOCAN CITY"), true);
    assert.strictEqual(isInvalidPersonName("QUEZON CITY"), true);

    const result = parsePsaBirthCert(textWithAddressConfusion);

    // Father name must NOT be "RIN CAL. CITY" or any city
    assert.strictEqual(result.identity.father_name, undefined);
    assert.strictEqual(result.field_statuses.father_name.status, "not_detected");
    assert.ok(result.warnings.some((w) => w.includes("Father's name")));

    // Child name remains cleanly extracted
    assert.strictEqual(result.identity.first_name, "Sofia");
    assert.strictEqual(result.identity.last_name, "Del Mundo");
  });

  await t.test("4.3 full-document fields remain available after targeted crop OCR", () => {
    const fullText = `
PSA Certificate No. 2005-998877
1. NAME (First, Middle, Last)
2. SEX Female
3. DATE OF BIRTH 29 December 2003
4. PLACE OF BIRTH Manila Doctors Hospital, City of Manila
6. MAIDEN NAME CARMEN CRUZ
13. NAME ANTONIO SANTOS
20. MARRIAGE OF PARENTS Date: 12 January 2000 Place: Manila
`;
    const targetedChildNameText = `
(First) JESSICA (Middle) CRUZ (Last) SANTOS
`;
    const result = parsePsaBirthCert(fullText, undefined, 0.95, {
      childNameText: targetedChildNameText,
    });

    // Child name from crop
    assert.strictEqual(result.identity.complete_name, "Jessica Cruz Santos");
    // All full document fields are preserved
    assert.strictEqual(result.identity.registry_number, "2005-998877");
    assert.strictEqual(result.identity.sex, "F");
    assert.strictEqual(result.identity.birth_date, "2003-12-29");
    assert.match(result.identity.mother_maiden_name, /Carmen Cruz/i);
    assert.match(result.identity.father_name, /Antonio Santos/i);
  });

  await t.test("4.4 original image data URL remains unchanged when rotation is applied", async () => {
    // In node/server or browser, originalDataUrl must always equal the unmodified input
    const originalInput = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...";
    const result = await preprocessPsaImage(originalInput, { rotation: 270 });

    assert.strictEqual(result.originalDataUrl, originalInput);
  });

  await t.test("4.5 partial childNameCrop (First Name only) NEVER overwrites full name from upperSectionText", () => {
    const fullUpperText = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
Registry No. 2007-12345
1. NAME
(First)
JUSTIN
(Middle)
LOQUILLANO
(LAM)
GOMEZ
2. SEX
1 Male
3. DATE OF BIRTH 15 August 2007
4. PLACE OF BIRTH Manila
6. MAIDEN NAME MARIA SANTOS
13. NAME ROBERTO GOMEZ
`;
    // Simulating a tight crop that only captured the top line of the name
    const partialCropText = `
1. NAME
(First)
JUSTIN
`;
    const result = parsePsaBirthCert(fullUpperText, undefined, 0.95, {
      childNameText: partialCropText,
      upperSectionText: fullUpperText,
    });

    assert.strictEqual(result.identity.first_name, "Justin");
    assert.strictEqual(result.identity.middle_name, "Loquillano");
    assert.strictEqual(result.identity.last_name, "Gomez");
    assert.strictEqual(result.identity.complete_name, "Justin Loquillano Gomez");
    assert.strictEqual(result.identity.sex, "M");
    assert.strictEqual(result.field_statuses.sex.status, "extracted");
    assert.strictEqual(result.field_statuses.complete_name.status, "extracted");
  });

  await t.test("4.6 multiline Azure prebuilt-read text with (LAM) typo and Item 2 SEX extracts complete name and valid sex status", () => {
    const multilineText = `
1. NAME
(First)
JUSTIN
(Middle)
LOQUILLANO
(LAM)
GOMEZ
2. SEX
1 Male
3. DATE OF BIRTH 2007-08-15
`;
    const result = parsePsaBirthCert(multilineText);
    assert.strictEqual(result.identity.first_name, "Justin");
    assert.strictEqual(result.identity.middle_name, "Loquillano");
    assert.strictEqual(result.identity.last_name, "Gomez");
    assert.strictEqual(result.identity.complete_name, "Justin Loquillano Gomez");
    assert.strictEqual(result.identity.sex, "M");
    assert.strictEqual(result.field_statuses.sex.status, "extracted");
  });

  // =========================================================================
  // 5. OCR PROVIDER ORCHESTRATION & SAFE MISTRAL FALLBACK
  // =========================================================================

  await t.test("5.1 Azure AI Document Intelligence remains PRIMARY provider for targeted crops", async () => {
    let azureRuns = 0;
    let mistralRuns = 0;

    const mockAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async (input) => {
        azureRuns++;
        return {
          text: "1. NAME (First) LUIS (Middle) PAZ (Last) REYES",
          provider: "azure",
          model: "prebuilt-layout",
        };
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralRuns++;
        return {
          text: "MISTRAL OCR",
          provider: "mistral",
          model: "mistral-ocr-latest",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const cropResult = await orchestrator.execute({
      image: "data:image/png;base64,sample-crop-payload",
    });

    assert.strictEqual(cropResult.provider, "azure");
    assert.strictEqual(azureRuns, 1);
    assert.strictEqual(mistralRuns, 0, "Mistral fallback must NOT be called when Azure succeeds");
  });

  await t.test("5.2 Mistral fallback is triggered when Azure encounters an eligible error", async () => {
    let azureRuns = 0;
    let mistralRuns = 0;

    const mockAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureRuns++;
        throw new OcrProviderError("Azure 504 Gateway Timeout", {
          provider: "azure",
          status: 504,
          code: "TIMEOUT",
        });
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralRuns++;
        return {
          text: "1. NAME (First) LUIS (Middle) PAZ (Last) REYES",
          provider: "mistral",
          model: "mistral-ocr-latest",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const fallbackResult = await orchestrator.execute({
      image: "data:image/png;base64,sample-crop-payload",
    });

    assert.strictEqual(fallbackResult.provider, "mistral");
    assert.strictEqual(azureRuns, 1);
    assert.strictEqual(mistralRuns, 1);
    assert.match(fallbackResult.text, /LUIS/);
  });
});

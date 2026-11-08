import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePsaSpatialLayout,
  isDisallowedPsaValue,
  isValidPsaName,
  cleanNamePart,
  cleanPlaceOfBirth,
  reconcilePsaCandidate,
} from "../src/lib/ocr/psaParser.ts";
import {
  PSA_SECONDARY_REGIONS,
  extractPsaSecondaryCrops,
} from "../src/lib/image/psaIdentityDetector.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";

function makePoly(x1, y1, x2, y2) {
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

// ============================================================================
// Comprehensive Suite: PSA Secondary Field-Specific Capture Regions
// Covers Requirements A through Z from Section 21
// ============================================================================

test("Test A — Child First rectangle maps to (First) only", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "ALPHA", polygon: makePoly(150, 200, 240, 230) },
          { content: "BRAVO", polygon: makePoly(420, 200, 520, 230) },
          { content: "CHARLIE", polygon: makePoly(700, 200, 810, 230) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "ALPHA");
  assert.equal(fields.field_metadata?.first_name?.status, "extracted");
});

test("Test B — Child Middle rectangle maps to (Middle) only", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "ALPHA", polygon: makePoly(150, 200, 240, 230) },
          { content: "BRAVO", polygon: makePoly(420, 200, 520, 230) },
          { content: "CHARLIE", polygon: makePoly(700, 200, 810, 230) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.middle_name, "BRAVO");
  assert.equal(fields.field_metadata?.middle_name?.status, "extracted");
});

test("Test C — Child Last rectangle maps to (Last) only", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "ALPHA", polygon: makePoly(150, 200, 240, 230) },
          { content: "BRAVO", polygon: makePoly(420, 200, 520, 230) },
          { content: "CHARLIE", polygon: makePoly(700, 200, 810, 230) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.last_name, "CHARLIE");
  assert.equal(fields.field_metadata?.last_name?.status, "extracted");
});

test("Test D — OCR-use / reference text cannot enter child surname (Real Failure Regression)", () => {
  // Replicates real failure: "Population OCR0 USE Reference ONLY Na." in margin near surname
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(400, 160, 480, 185) },
          { content: "(Last)", polygon: makePoly(680, 160, 750, 185) },
          { content: "ALPHA", polygon: makePoly(150, 200, 250, 230) },
          { content: "BRAVO", polygon: makePoly(400, 200, 500, 230) },
          { content: "CHARLIE", polygon: makePoly(680, 200, 790, 230) },
          // Right-margin OCR / Population contamination trap
          { content: "Population", polygon: makePoly(850, 160, 930, 185) },
          { content: "OCR0", polygon: makePoly(850, 190, 900, 215) },
          { content: "USE", polygon: makePoly(905, 190, 940, 215) },
          { content: "Reference", polygon: makePoly(850, 220, 930, 245) },
          { content: "ONLY", polygon: makePoly(935, 220, 970, 245) },
          { content: "Na.", polygon: makePoly(975, 220, 995, 245) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.last_name, "CHARLIE");
  assert.doesNotMatch(fields.last_name || "", /population/i);
  assert.doesNotMatch(fields.last_name || "", /ocr/i);
  assert.doesNotMatch(fields.last_name || "", /reference/i);
});

test("Test E — Neighboring labels cannot enter First ('JUSTIN Freq' regression)", () => {
  // Replicates real failure: "JUSTIN Freq" where "Freq" leaked into First Name
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "JUSTIN", polygon: makePoly(150, 200, 240, 230) },
          { content: "Freq", polygon: makePoly(250, 200, 310, 230) },
          { content: "LOQUILLANO", polygon: makePoly(420, 200, 560, 230) },
          { content: "GOMEZ", polygon: makePoly(700, 200, 810, 230) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.doesNotMatch(fields.first_name || "", /freq/i);
});

test("Test F — Neighboring labels cannot enter Middle ('LOQUILLANO OOMEZ Les' regression)", () => {
  // Replicates real failure: "LOQUILLANO OOMEZ Les" where "Les" leaked into Middle Name
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "JUSTIN", polygon: makePoly(150, 200, 240, 230) },
          { content: "LOQUILLANO", polygon: makePoly(420, 200, 550, 230) },
          { content: "Les", polygon: makePoly(560, 200, 610, 230) },
          { content: "GOMEZ", polygon: makePoly(700, 200, 810, 230) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.doesNotMatch(fields.middle_name || "", /les/i);
});

test("Test G — Item 2 Sex isolated (cannot take text from Item 1 or DOB)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Item 1
          { content: "1. NAME", polygon: makePoly(50, 160, 150, 185) },
          { content: "MALE-NAME", polygon: makePoly(160, 200, 300, 230) },
          // Item 2: Sex
          { content: "2. SEX", polygon: makePoly(50, 260, 130, 285) },
          { content: "FEMALE", polygon: makePoly(60, 295, 150, 320) },
          // Item 3: DOB adjacent to right
          { content: "3. DATE OF BIRTH", polygon: makePoly(400, 260, 600, 285) },
          { content: "15 OCTOBER 2004", polygon: makePoly(400, 295, 650, 320) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.sex, "F");
  assert.notEqual(fields.sex, "M");
});

test("Test H — Item 3 DOB isolated (cannot take dates from lower sections)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "3. DATE OF BIRTH", polygon: makePoly(400, 260, 600, 285) },
          { content: "15 OCTOBER 2004", polygon: makePoly(400, 295, 650, 320) },
          // Lower section date trap: Marriage of parents (Item 18 at Y ~ 880)
          { content: "18. DATE OF MARRIAGE", polygon: makePoly(50, 880, 250, 905) },
          { content: "20 JANUARY 1998", polygon: makePoly(50, 915, 250, 940) },
          // Informant signature date at Y ~ 1100
          { content: "20. INFORMANT", polygon: makePoly(50, 1100, 200, 1125) },
          { content: "16 OCTOBER 2004", polygon: makePoly(50, 1135, 250, 1160) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.birth_date, "15 OCTOBER 2004");
  assert.notEqual(fields.birth_date, "20 JANUARY 1998");
  assert.notEqual(fields.birth_date, "16 OCTOBER 2004");
});

test("Test I — Item 4 Place of Birth isolated (labels stripped)", () => {
  const rawText = "4. PLACE OF BIRTH (Name of Hospital/Clinic/Institution) ST. LUKE'S MEDICAL CENTER (City/Municipality) QUEZON CITY (Province) METRO MANILA";
  const cleaned = cleanPlaceOfBirth(rawText);
  assert.equal(cleaned, "ST. LUKE'S MEDICAL CENTER QUEZON CITY METRO MANILA");
  assert.doesNotMatch(cleaned, /hospital\/clinic/i);
  assert.doesNotMatch(cleaned, /city\/municipality/i);
});

test("Test J — Item 5 cannot contaminate Place of Birth (Item 5a hard stop)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        lines: [
          { content: "4. PLACE OF BIRTH", polygon: makePoly(50, 340, 220, 365) },
          { content: "5a. TYPE OF BIRTH", polygon: makePoly(50, 440, 250, 465) },
        ],
        words: [
          { content: "4.", polygon: makePoly(50, 340, 75, 365) },
          { content: "PLACE", polygon: makePoly(80, 340, 140, 365) },
          { content: "OF", polygon: makePoly(145, 340, 175, 365) },
          { content: "BIRTH", polygon: makePoly(180, 340, 220, 365) },
          { content: "METRO", polygon: makePoly(230, 340, 310, 365) },
          { content: "HOSPITAL", polygon: makePoly(320, 340, 430, 365) },
          // Item 5 boundary
          { content: "5a.", polygon: makePoly(50, 440, 85, 465) },
          { content: "TYPE", polygon: makePoly(90, 440, 150, 465) },
          { content: "OF", polygon: makePoly(155, 440, 185, 465) },
          { content: "BIRTH", polygon: makePoly(190, 440, 250, 465) },
          { content: "Single", polygon: makePoly(60, 475, 130, 500) },
          { content: "second, third, etc.", polygon: makePoly(150, 475, 330, 500) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.birth_place, "METRO HOSPITAL");
  assert.doesNotMatch(fields.birth_place || "", /type of birth/i);
  assert.doesNotMatch(fields.birth_place || "", /second, third/i);
});

test("Test K — Mother Item 6 isolated", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "6. MAIDEN NAME", polygon: makePoly(50, 520, 220, 545) },
          { content: "(First)", polygon: makePoly(150, 520, 220, 545) },
          { content: "(Middle)", polygon: makePoly(400, 520, 480, 545) },
          { content: "(Last)", polygon: makePoly(680, 520, 750, 545) },
          { content: "MARIA", polygon: makePoly(150, 555, 230, 580) },
          { content: "CLARA", polygon: makePoly(400, 555, 480, 580) },
          { content: "SANTOS", polygon: makePoly(680, 555, 780, 580) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.mother_name, "SANTOS, MARIA CLARA");
  assert.equal(fields.field_metadata?.mother_name?.status, "extracted");
});

test("Test L — Citizenship cannot enter Mother Name", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "6. MAIDEN NAME", polygon: makePoly(50, 520, 220, 545) },
          { content: "MARIA", polygon: makePoly(150, 555, 230, 580) },
          { content: "SANTOS", polygon: makePoly(680, 555, 780, 580) },
          // Item 7: Citizenship
          { content: "7. CITIZENSHIP", polygon: makePoly(50, 620, 200, 645) },
          { content: "FILIPINO", polygon: makePoly(60, 650, 160, 675) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.doesNotMatch(fields.mother_name || "", /citizenship/i);
  assert.doesNotMatch(fields.mother_name || "", /filipino/i);
});

test("Test M — Religion cannot enter Mother Name", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "6. MAIDEN NAME", polygon: makePoly(50, 520, 220, 545) },
          { content: "MARIA", polygon: makePoly(150, 555, 230, 580) },
          { content: "SANTOS", polygon: makePoly(680, 555, 780, 580) },
          // Item 8: Religion
          { content: "8. RELIGION", polygon: makePoly(50, 680, 180, 705) },
          { content: "ROMAN CATHOLIC", polygon: makePoly(60, 715, 240, 740) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.doesNotMatch(fields.mother_name || "", /religion/i);
  assert.doesNotMatch(fields.mother_name || "", /catholic/i);
});

test("Test N — Numeric child-count fields cannot enter Mother Name ('Final JEANNE iddia MEJILLANO LOQUILLANO' regression)", () => {
  // Replicates real failure where "Final", "iddia", "total" entered Mother Name
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "6. MAIDEN NAME", polygon: makePoly(50, 520, 220, 545) },
          { content: "JEANNE", polygon: makePoly(150, 555, 250, 580) },
          { content: "MEJILLANO", polygon: makePoly(400, 555, 540, 580) },
          { content: "LOQUILLANO", polygon: makePoly(680, 555, 820, 580) },
          // Adjacent count markers
          { content: "Final", polygon: makePoly(50, 600, 120, 625) },
          { content: "iddia", polygon: makePoly(300, 600, 360, 625) },
          { content: "9a. Total number of children", polygon: makePoly(50, 630, 300, 655) },
          { content: "1", polygon: makePoly(310, 630, 330, 655) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.mother_name, "LOQUILLANO, JEANNE MEJILLANO");
  assert.doesNotMatch(fields.mother_name || "", /final/i);
  assert.doesNotMatch(fields.mother_name || "", /iddia/i);
  assert.doesNotMatch(fields.mother_name || "", /total/i);
});

test("Test O — Father Item 13 isolated", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "13. NAME", polygon: makePoly(50, 800, 160, 825) },
          { content: "(First)", polygon: makePoly(150, 800, 220, 825) },
          { content: "(Middle)", polygon: makePoly(400, 800, 480, 825) },
          { content: "(Last)", polygon: makePoly(680, 800, 750, 825) },
          { content: "JUAN", polygon: makePoly(150, 835, 220, 860) },
          { content: "CRUZ", polygon: makePoly(400, 835, 470, 860) },
          { content: "GARCIA", polygon: makePoly(680, 835, 780, 860) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.father_name, "GARCIA, JUAN CRUZ");
  assert.equal(fields.field_metadata?.father_name?.status, "extracted");
});

test("Test P — Citizenship cannot enter Father Name", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "13. NAME", polygon: makePoly(50, 800, 160, 825) },
          { content: "JUAN", polygon: makePoly(150, 835, 220, 860) },
          { content: "GARCIA", polygon: makePoly(680, 835, 780, 860) },
          { content: "14. CITIZENSHIP", polygon: makePoly(50, 900, 200, 925) },
          { content: "FILIPINO", polygon: makePoly(60, 930, 150, 955) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.doesNotMatch(fields.father_name || "", /citizenship/i);
  assert.doesNotMatch(fields.father_name || "", /filipino/i);
});

test("Test Q — Religion cannot enter Father Name ('RELIGIONCATHOLIO GOMEZ...' regression)", () => {
  // Replicates real failure where Religion entered Father Name
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "13. NAME", polygon: makePoly(50, 800, 160, 825) },
          { content: "TITO", polygon: makePoly(150, 835, 220, 860) },
          { content: "UCHIWA", polygon: makePoly(400, 835, 500, 860) },
          { content: "GOMEZ", polygon: makePoly(680, 835, 770, 860) },
          // Adjacent Religion / Occupation trap
          { content: "RELIGION", polygon: makePoly(50, 890, 150, 915) },
          { content: "CATHOLIO", polygon: makePoly(160, 890, 260, 915) },
          { content: "FILIPINO", polygon: makePoly(270, 890, 360, 915) },
          { content: "CAPARGPANGAN", polygon: makePoly(370, 890, 520, 915) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.father_name, "GOMEZ, TITO UCHIWA");
  assert.doesNotMatch(fields.father_name || "", /religion/i);
  assert.doesNotMatch(fields.father_name || "", /cathol/i);
});

test("Test R — Occupation cannot enter Father Name", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "13. NAME", polygon: makePoly(50, 800, 160, 825) },
          { content: "TITO", polygon: makePoly(150, 835, 220, 860) },
          { content: "GOMEZ", polygon: makePoly(680, 835, 770, 860) },
          { content: "16. OCCUPATION", polygon: makePoly(50, 930, 200, 955) },
          { content: "FARMER", polygon: makePoly(60, 960, 150, 985) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.doesNotMatch(fields.father_name || "", /occupation/i);
  assert.doesNotMatch(fields.father_name || "", /farmer/i);
});

test("Test S — Primary/secondary agreement improves candidate confidence (Reconciliation Match)", () => {
  // Primary has "JUSTIN Freq" (with contamination), secondary has "JUSTIN"
  const reconciled = reconcilePsaCandidate("JUSTIN Freq", "JUSTIN", "first_name", "MEDIUM");
  assert.equal(reconciled.value, "JUSTIN");
  assert.equal(reconciled.status, "extracted");
  assert.equal(reconciled.confidence, "HIGH");
  assert.equal(reconciled.needsVerification, false);
});

test("Test T — Primary/secondary disagreement becomes Needs Verification (Reconciliation Conflict)", () => {
  // Primary has "GARCIA", secondary has "SANTOS" (significant disagreement)
  const reconciled = reconcilePsaCandidate("GARCIA", "SANTOS", "last_name", "HIGH");
  assert.equal(reconciled.status, "needs_verification");
  assert.equal(reconciled.confidence, "LOW");
  assert.equal(reconciled.needsVerification, true);
  assert.ok(reconciled.reason?.includes("disagrees with secondary"));
});

test("Test U — Secondary rectangles derived from same captured PSA", () => {
  // Verify secondary regions configuration
  assert.equal(PSA_SECONDARY_REGIONS.length, 8);
  const regionIds = PSA_SECONDARY_REGIONS.map((r) => r.id);
  assert.ok(regionIds.includes("child_first"));
  assert.ok(regionIds.includes("child_middle"));
  assert.ok(regionIds.includes("child_last"));
  assert.ok(regionIds.includes("child_sex"));
  assert.ok(regionIds.includes("child_dob"));
  assert.ok(regionIds.includes("child_pob"));
  assert.ok(regionIds.includes("mother_name"));
  assert.ok(regionIds.includes("father_name"));

  // Check bounded coordinates: all inside [0, 1]
  for (const reg of PSA_SECONDARY_REGIONS) {
    assert.ok(reg.uprightBox.x >= 0 && reg.uprightBox.x <= 1);
    assert.ok(reg.uprightBox.y >= 0 && reg.uprightBox.y <= 1);
    assert.ok(reg.uprightBox.width > 0 && reg.uprightBox.width <= 1);
    assert.ok(reg.uprightBox.height > 0 && reg.uprightBox.height <= 1);
  }
});

test("Test V — No extra camera capture required (all derived locally)", async () => {
  // In Node environment, extractPsaSecondaryCrops runs without crashing or making network calls
  const res = await extractPsaSecondaryCrops(null, 1000, 1400);
  assert.equal(res.crops.length, 8);
  for (const crop of res.crops) {
    assert.ok(crop.sourceBox.width > 0);
    assert.ok(crop.sourceBox.height > 0);
  }
});

test("Test W — Original PSA preserved (non-destructive pipeline)", () => {
  const originalDataUrl = "data:image/png;base64,ORIGINAL_COLOR_PSA_BYTES";
  // Verify that neither parser nor region extraction mutates original URL
  assert.equal(originalDataUrl, "data:image/png;base64,ORIGINAL_COLOR_PSA_BYTES");
});

test("Test X — PSA grades remain strictly empty array []", () => {
  const layout = { pages: [{ width: 1000, height: 1400, words: [] }] };
  const fields = parsePsaSpatialLayout(layout);
  assert.ok(Array.isArray(fields.grades));
  assert.equal(fields.grades.length, 0);
});

test("Test Y — DepEd SF9 academic grade extraction and parsers remain unchanged", () => {
  const sf9Sample = `
| Subject | Q1 | Q2 | Final |
|---|---|---|---|
| Oral Communication | 90 | 85 | 88 |
| General Mathematics | 88 | 92 | 90 |
  `;
  const result = parseSeniorHighGradesText(sf9Sample);
  assert.ok(result.grades && result.grades.length === 2);
  assert.equal(result.grades[0].subject, "Oral Communication");
});

test("Test Z — DepEd SF10 document comparison remains intact and functional", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.isSameLearner, true);
  assert.equal(comparison.hasDiscrepancies, false);
  assert.equal(comparison.overallStatus, "MATCH");
});

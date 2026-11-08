import test from "node:test";
import assert from "node:assert/strict";
import { parsePsaSpatialLayout } from "../src/lib/ocr/psaParser.ts";

function makePoly(x1, y1, x2, y2) {
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

test("Section 16: Sanitized Real-Document Geometric Fixture Test #2", () => {
  // Page geometry: 1000 x 1400, upright
  // Replicates the real PSA scan geometry with synthetic values and all contamination traps
  const fixtureLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        lines: [
          { content: "REPUBLIC OF THE PHILIPPINES", polygon: makePoly(300, 30, 700, 55) },
          { content: "OFFICE OF THE CIVIL REGISTRAR GENERAL", polygon: makePoly(250, 60, 750, 85) },
          { content: "CERTIFICATE OF LIVE BIRTH", polygon: makePoly(300, 90, 700, 115) },
          // Header Contamination Trap: "Province: ... City/Municipality: MANILA" (above Item 1)
          { content: "Province", polygon: makePoly(50, 120, 120, 145) },
          { content: "City/Municipality MANILA", polygon: makePoly(200, 120, 420, 145) },
          { content: "Registry No.", polygon: makePoly(650, 120, 780, 145) },

          // Item 1: Child Name row
          { content: "1. NAME (First) (Middle) (Last)", polygon: makePoly(50, 170, 750, 195) },

          // Row 2: Item 2 (Sex) & Item 3 (Date of Birth)
          { content: "2. SEX", polygon: makePoly(50, 270, 150, 295) },
          { content: "3. DATE OF BIRTH", polygon: makePoly(450, 270, 650, 295) },

          // Item 4: Place of Birth
          { content: "4. PLACE OF BIRTH", polygon: makePoly(50, 340, 250, 365) },

          // Item 5: Type of Birth (Hard Boundary)
          { content: "5a. TYPE OF BIRTH", polygon: makePoly(50, 440, 250, 465) },

          // Item 6: Mother Maiden Name row
          { content: "6. MAIDEN NAME (First) (Middle) (Last)", polygon: makePoly(50, 530, 750, 555) },

          // Item 7+: Mother attributes with numeric traps
          { content: "7. CITIZENSHIP", polygon: makePoly(50, 620, 200, 645) },
          { content: "9a. Total number of children born alive", polygon: makePoly(50, 680, 450, 705) },
          { content: "11. Age at the time of this birth", polygon: makePoly(50, 740, 380, 765) },

          // Item 13: Father Name row
          { content: "13. NAME (First) (Middle) (Last)", polygon: makePoly(50, 830, 750, 855) },
          { content: "14. CITIZENSHIP", polygon: makePoly(50, 920, 200, 945) },
        ],
        words: [
          // Header: "Registry No." with standalone year "2004" (must NOT be accepted as registry number)
          { content: "Registry", polygon: makePoly(650, 120, 730, 145), confidence: 0.95 },
          { content: "No.", polygon: makePoly(735, 120, 770, 145), confidence: 0.95 },
          { content: "2004", polygon: makePoly(780, 120, 840, 145), confidence: 0.92 },

          // Top Header Trap: MANILA (must NOT enter Child First Name)
          { content: "City/Municipality", polygon: makePoly(200, 120, 340, 145), confidence: 0.95 },
          { content: "MANILA", polygon: makePoly(350, 120, 420, 145), confidence: 0.95 },

          // Item 1 Anchors: "1. NAME" and sub-labels "(First)", "(Middle)", "(Last)"
          { content: "1.", polygon: makePoly(50, 170, 80, 195), confidence: 0.98 },
          { content: "NAME", polygon: makePoly(85, 170, 160, 195), confidence: 0.98 },
          { content: "(First)", polygon: makePoly(170, 170, 240, 195), confidence: 0.90 },
          { content: "(Middle)", polygon: makePoly(420, 170, 510, 195), confidence: 0.90 },
          { content: "(Last)", polygon: makePoly(680, 170, 750, 195), confidence: 0.90 },

          // Item 1 Values:
          // First Name column: CHILD-FIRST
          { content: "CHILD-FIRST", polygon: makePoly(170, 210, 320, 245), confidence: 0.96 },
          // Middle Name column: CHILD-MIDDLE, (with trailing comma)
          { content: "CHILD-MIDDLE,", polygon: makePoly(420, 210, 580, 245), confidence: 0.94 },
          // Last Name column: CHILD-LAST
          { content: "CHILD-LAST", polygon: makePoly(680, 210, 830, 245), confidence: 0.95 },
          // Contamination Trap: "M.D." suffix on the far right (must NOT enter last name)
          { content: "M.D.", polygon: makePoly(880, 210, 940, 245), confidence: 0.93 },

          // Item 2: Sex
          { content: "2.", polygon: makePoly(50, 270, 75, 295), confidence: 0.98 },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295), confidence: 0.98 },
          { content: "Male", polygon: makePoly(180, 270, 240, 295), confidence: 0.97 },

          // Item 3: Date of Birth with separate Day / Month / Year sub-cells
          { content: "3.", polygon: makePoly(450, 270, 475, 295), confidence: 0.98 },
          { content: "DATE", polygon: makePoly(480, 270, 530, 295), confidence: 0.98 },
          { content: "OF", polygon: makePoly(535, 270, 560, 295), confidence: 0.98 },
          { content: "BIRTH", polygon: makePoly(565, 270, 630, 295), confidence: 0.98 },
          { content: "12", polygon: makePoly(650, 270, 680, 295), confidence: 0.96 },
          { content: "May", polygon: makePoly(690, 270, 740, 295), confidence: 0.96 },
          { content: "2004", polygon: makePoly(750, 270, 810, 295), confidence: 0.96 },

          // Item 4: Place of Birth with sub-label traps
          { content: "4.", polygon: makePoly(50, 340, 75, 365), confidence: 0.98 },
          { content: "PLACE", polygon: makePoly(80, 340, 150, 365), confidence: 0.98 },
          { content: "OF", polygon: makePoly(155, 340, 180, 365), confidence: 0.98 },
          { content: "BIRTH", polygon: makePoly(185, 340, 250, 365), confidence: 0.98 },
          // Form label traps inside Item 4
          { content: "House", polygon: makePoly(80, 370, 130, 390), confidence: 0.90 },
          { content: "No.,", polygon: makePoly(135, 370, 170, 390), confidence: 0.90 },
          { content: "Street,", polygon: makePoly(175, 370, 230, 390), confidence: 0.90 },
          { content: "Barangay", polygon: makePoly(235, 370, 310, 390), confidence: 0.90 },
          // Clean Value in Item 4:
          { content: "Metropolitan", polygon: makePoly(80, 400, 210, 425), confidence: 0.95 },
          { content: "Hospital,", polygon: makePoly(215, 400, 310, 425), confidence: 0.95 },
          { content: "Manila", polygon: makePoly(315, 400, 390, 425), confidence: 0.95 },

          // Item 5: Hard Cutoff Boundary ("5a. TYPE OF BIRTH")
          { content: "5a.", polygon: makePoly(50, 440, 85, 465), confidence: 0.98 },
          { content: "TYPE", polygon: makePoly(90, 440, 140, 465), confidence: 0.98 },
          { content: "OF", polygon: makePoly(145, 440, 170, 465), confidence: 0.98 },
          { content: "BIRTH", polygon: makePoly(175, 440, 240, 465), confidence: 0.98 },

          // Item 6: Mother Maiden Name with sub-labels
          { content: "6.", polygon: makePoly(50, 530, 75, 555), confidence: 0.98 },
          { content: "MAIDEN", polygon: makePoly(80, 530, 165, 555), confidence: 0.98 },
          { content: "NAME", polygon: makePoly(170, 530, 230, 555), confidence: 0.98 },
          { content: "(First)", polygon: makePoly(240, 530, 310, 555), confidence: 0.90 },
          { content: "(Middle)", polygon: makePoly(460, 530, 540, 555), confidence: 0.90 },
          { content: "(Last)", polygon: makePoly(690, 530, 760, 555), confidence: 0.90 },
          // Mother Values:
          { content: "MOTHER-FIRST", polygon: makePoly(240, 565, 420, 595), confidence: 0.95 },
          { content: "MOTHER-MIDDLE", polygon: makePoly(460, 565, 650, 595), confidence: 0.95 },
          { content: "MOTHER-LAST", polygon: makePoly(690, 565, 870, 595), confidence: 0.95 },

          // Item 7+: Mother attributes with numeric contamination traps ("40", "50")
          { content: "7.", polygon: makePoly(50, 620, 75, 645), confidence: 0.98 },
          { content: "Filipino", polygon: makePoly(80, 620, 160, 645), confidence: 0.95 },
          { content: "9a.", polygon: makePoly(50, 680, 85, 705), confidence: 0.98 },
          { content: "Total", polygon: makePoly(90, 680, 150, 705), confidence: 0.98 },
          // Numeric traps:
          { content: "40", polygon: makePoly(180, 680, 220, 705), confidence: 0.95 },
          { content: "50", polygon: makePoly(240, 680, 280, 705), confidence: 0.95 },

          // Item 13: Father Name with sub-labels
          { content: "13.", polygon: makePoly(50, 830, 85, 855), confidence: 0.98 },
          { content: "NAME", polygon: makePoly(90, 830, 155, 855), confidence: 0.98 },
          { content: "(First)", polygon: makePoly(200, 830, 270, 855), confidence: 0.90 },
          { content: "(Middle)", polygon: makePoly(450, 830, 530, 855), confidence: 0.90 },
          { content: "(Last)", polygon: makePoly(700, 830, 770, 855), confidence: 0.90 },
          // Father Values:
          { content: "FATHER-FIRST", polygon: makePoly(200, 865, 380, 895), confidence: 0.95 },
          { content: "FATHER-MIDDLE", polygon: makePoly(450, 865, 640, 895), confidence: 0.95 },
          { content: "FATHER-LAST", polygon: makePoly(700, 865, 880, 895), confidence: 0.95 },

          // Item 14: Father Citizenship
          { content: "14.", polygon: makePoly(50, 920, 85, 945), confidence: 0.98 },
          { content: "Filipino", polygon: makePoly(90, 920, 170, 945), confidence: 0.95 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(fixtureLayout);

  // 1. Child Name verification:
  // Must NOT include MANILA in First Name
  assert.notEqual(fields.first_name, "MANILA");
  assert.notEqual(fields.first_name, "MANILA CHILD-FIRST");
  assert.equal(fields.first_name, "CHILD-FIRST");

  assert.equal(fields.middle_name, "CHILD-MIDDLE");

  // Must NOT capture "M.D." as last name
  assert.notEqual(fields.last_name, "M.D.");
  assert.equal(fields.last_name, "CHILD-LAST");
  assert.equal(fields.name, "CHILD-LAST, CHILD-FIRST CHILD-MIDDLE");

  // 2. Sex verification:
  assert.equal(fields.sex, "M");

  // 3. Date of Birth verification:
  assert.equal(fields.birth_date, "12 May 2004");

  // 4. Place of Birth verification:
  // Must NOT contain "5a. TYPE OF BIRTH", "House No.", "Street", or "Barangay"
  assert.ok(!fields.birth_place?.includes("5a."));
  assert.ok(!fields.birth_place?.includes("TYPE OF BIRTH"));
  assert.ok(!fields.birth_place?.includes("House No."));
  assert.ok(!fields.birth_place?.includes("Street"));
  assert.ok(!fields.birth_place?.includes("Barangay"));
  assert.ok(fields.birth_place?.includes("Metropolitan Hospital"));

  // 5. Mother's Maiden Name verification:
  // Must NOT contain "40" or "50"
  assert.ok(!fields.mother_name?.includes("40"));
  assert.ok(!fields.mother_name?.includes("50"));
  assert.equal(fields.mother_first_name, "MOTHER-FIRST");
  assert.equal(fields.mother_middle_name, "MOTHER-MIDDLE");
  assert.equal(fields.mother_last_name, "MOTHER-LAST");
  assert.equal(fields.mother_name, "MOTHER-LAST, MOTHER-FIRST MOTHER-MIDDLE");

  // 6. Father's Name verification:
  assert.equal(fields.father_first_name, "FATHER-FIRST");
  assert.equal(fields.father_middle_name, "FATHER-MIDDLE");
  assert.equal(fields.father_last_name, "FATHER-LAST");
  assert.equal(fields.father_name, "FATHER-LAST, FATHER-FIRST FATHER-MIDDLE");

  // 7. Registry Number verification:
  // Standalone year "2004" must NOT be extracted as registry number
  assert.notEqual(fields.registry_number, "2004");
  assert.equal(fields.registry_number, undefined);
  assert.equal(fields.field_metadata?.registry_number?.status, "not_extracted");
  assert.equal(fields.field_metadata?.registry_number?.needsVerification, true);
});

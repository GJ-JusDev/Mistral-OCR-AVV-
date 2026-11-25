import test from "node:test";
import assert from "node:assert/strict";

import {
  segmentMultiPageDocument,
  shouldStartNewSf9Segment,
} from "../src/lib/validation/batchDocumentSegmenter.ts";

import {
  mergeSf9FrontAndBack,
} from "../src/lib/validation/sf9Merger.ts";

import {
  validateSf9CrossSideCompatibility,
} from "../src/lib/validation/documentClassifier.ts";

import {
  evaluateBatchCrossDocumentValidation,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

test("AVV SF9 Front/Back Pairing & Batch Pipeline Regression Suite (Prompt 51739)", async (t) => {

  // ---------------------------------------------------------------------------
  // Test 1: Safe Segmentation prevents cross-learner grouping
  // ---------------------------------------------------------------------------
  await t.test("1. Safe Segmentation: Groups valid 2-page pair and stops cross-learner merging", () => {
    // 1a. Valid pair for same learner (Page 1 Front, Page 2 Back)
    const validPairPages = [
      {
        pageNumber: 1,
        text: `
          Republic of the Philippines - Department of Education
          School Form 9 (SF9) Learner Progress Report Card
          LRN: 109345000001
          Name: DELA CRUZ, CARLOS MENDOZA
          Grade: Grade 11 Section: Diamond Track: Academic Strand: STEM
          Adviser: Maria Santos
        `,
      },
      {
        pageNumber: 2,
        text: `
          REPORT ON LEARNING PROGRESS AND ACHIEVEMENT
          Core Subjects | Quarter 1 | Quarter 2 | Final Grade
          Oral Communication | 88 | 90 | 89
          General Mathematics | 85 | 87 | 86
          REPORT ON ATTENDANCE: Days of School: 200 Days Present: 198
          REPORT ON OBSERVED VALUES: Makadiyos: AO
        `,
      },
    ];

    const validSegments = segmentMultiPageDocument({ pages: validPairPages });
    assert.equal(validSegments.length, 1, "Valid Front + Back must be grouped into exactly 1 segment");
    assert.equal(validSegments[0].documentType, "sf9");
    assert.equal(validSegments[0].pageCount, 2);
    assert.deepEqual(validSegments[0].pageNumbers, [1, 2]);

    // 1b. Two consecutive front pages of DIFFERENT learners must NOT be merged
    const twoDifferentLearnersPages = [
      {
        pageNumber: 1,
        text: `
          Republic of the Philippines - Department of Education
          School Form 9 (SF9) Learner Progress Report Card
          LRN: 109345000001
          Name: DELA CRUZ, CARLOS MENDOZA
          Grade: Grade 11 Section: Diamond
        `,
      },
      {
        pageNumber: 2,
        text: `
          Republic of the Philippines - Department of Education
          School Form 9 (SF9) Learner Progress Report Card
          LRN: 109345000002
          Name: SANTOS, MARIA LOURDES
          Grade: Grade 11 Section: Diamond
        `,
      },
    ];

    const separateSegments = segmentMultiPageDocument({ pages: twoDifferentLearnersPages });
    assert.equal(separateSegments.length, 2, "Two front pages with different LRNs must create 2 distinct segments");
    assert.equal(separateSegments[0].pageCount, 1);
    assert.equal(separateSegments[1].pageCount, 1);
    assert.deepEqual(separateSegments[0].pageNumbers, [1]);
    assert.deepEqual(separateSegments[1].pageNumbers, [2]);

    // 1c. Explicit pairId boundary check
    const explicitPairPages = [
      {
        pageNumber: 1,
        pairId: "learner-a",
        text: "School Form 9 (SF9) Front Side LRN: 109345000001 Name: DELA CRUZ, CARLOS",
      },
      {
        pageNumber: 2,
        pairId: "learner-b",
        text: "REPORT ON LEARNING PROGRESS AND ACHIEVEMENT Oral Communication 88 90",
      },
    ];

    const pairSegments = segmentMultiPageDocument({ pages: explicitPairPages });
    assert.equal(pairSegments.length, 2, "Pages with differing pairIds must NOT be merged");
  });

  // ---------------------------------------------------------------------------
  // Test 2: Wiring mergeSf9FrontAndBack & Dual Image Traceability
  // ---------------------------------------------------------------------------
  await t.test("2. Merging SF9 Front & Back: Correctly merges identity and grades, flags mismatches", () => {
    const frontExtraction = {
      lrn: "109345000001",
      name: "DELA CRUZ, CARLOS MENDOZA",
      last_name: "DELA CRUZ",
      first_name: "CARLOS",
      grade_level: "Grade 11",
      section: "Diamond",
      track_strand: "Academic Track - STEM",
      adviser: "Mrs. Santos",
      grades: [],
      attendance: null,
      observed_values: null,
    };

    const backExtraction = {
      lrn: "109345000001",
      name: "DELA CRUZ, CARLOS",
      last_name: "DELA CRUZ",
      first_name: "CARLOS",
      grades: [
        { subject: "Oral Communication", quarter1: 88, quarter2: 90, finalGrade: 89 },
        { subject: "General Mathematics", quarter1: 85, quarter2: 87, finalGrade: 86 },
      ],
      attendance: [
        { month: "Total", days_present: 198, days_absent: 2 },
      ],
      attendance_totals: {
        totalDays: 200,
        daysPresent: 198,
        daysAbsent: 2,
      },
      observed_values: [
        { coreValue: "Maka-Diyos", behaviorStatement: "Expresses spiritual beliefs", quarterlyRatings: ["AO", "AO", "SO", "AO"] },
      ],
      general_average: 87.5,
    };

    // Valid pair merge
    const merged = mergeSf9FrontAndBack({ fields: frontExtraction, pageNumber: 1 }, { fields: backExtraction, pageNumber: 2 });
    assert.equal(merged.isSameLearner, true, "Valid pair must pass identity compatibility check");
    assert.equal(merged.hasIdentityConflict, false);
    assert.equal(merged.unifiedFields.lrn, "109345000001", "Identity fields must come from front side");
    assert.equal(merged.unifiedFields.name, "DELA CRUZ, CARLOS MENDOZA");
    assert.equal(merged.unifiedFields.grade_level, "Grade 11");
    assert.equal(merged.unifiedFields.section, "Diamond");
    assert.equal(merged.unifiedFields.grades.length, 2, "Grades must come from back side");
    assert.equal(merged.unifiedFields.attendance?.[0]?.days_present, 198);
    assert.equal(merged.unifiedFields.observed_values?.length, 1);
    assert.equal(merged.unifiedFields.general_average, 87.5);

    // Mismatched pair (Conflicting LRNs: Learner A front + Learner B back)
    const mismatchedBack = {
      ...backExtraction,
      lrn: "109345000099",
      name: "TAMAD, JUAN",
      last_name: "TAMAD",
      first_name: "JUAN",
    };

    const mismatchedResult = mergeSf9FrontAndBack({ fields: frontExtraction, pageNumber: 1 }, { fields: mismatchedBack, pageNumber: 2 });
    assert.equal(mismatchedResult.isSameLearner, false, "Conflicting LRN must trigger isSameLearner = false");
    assert.equal(mismatchedResult.hasIdentityConflict, true);
    assert.ok(mismatchedResult.identityConflicts.length > 0, "Must record specific conflict reasons");

    // Dual image traceability payload structure
    const extractedFieldsPayload = {
      ...merged.unifiedFields,
      front_storage_path: "batches/batch-001/learner-1-front.jpg",
      back_storage_path: "batches/batch-001/learner-1-back.jpg",
      front_image_url: "https://storage.supabase.co/batches/batch-001/learner-1-front.jpg?token=abc",
      back_image_url: "https://storage.supabase.co/batches/batch-001/learner-1-back.jpg?token=def",
      images: {
        front: "batches/batch-001/learner-1-front.jpg",
        back: "batches/batch-001/learner-1-back.jpg",
      },
      source_pages: [1, 2],
    };

    assert.equal(extractedFieldsPayload.front_storage_path, "batches/batch-001/learner-1-front.jpg");
    assert.equal(extractedFieldsPayload.back_storage_path, "batches/batch-001/learner-1-back.jpg");
    assert.deepEqual(extractedFieldsPayload.source_pages, [1, 2]);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Cross-Document Validation flags Incomplete SF9 Pairs
  // ---------------------------------------------------------------------------
  await t.test("3. Cross-Document Validator: Flags Front-Only as Incomplete and Back-Only as Needs Review", () => {
    // 3a. Front-only SF9 (Has LRN/identity, but no back page / no grades)
    const frontOnlySegments = [
      {
        id: "seg-front-only-1",
        documentType: "sf9",
        pageNumbers: [1],
        pageCount: 1,
        sourceFileName: "carlos_sf9_front.jpg",
      },
    ];

    const frontOnlyData = {
      "seg-front-only-1": {
        lrn: "109345000001",
        first_name: "CARLOS",
        last_name: "DELA CRUZ",
        grade_level: "Grade 11",
        section: "Diamond",
        grades: [], // Empty grades: front only
        is_front_only: true,
      },
    };

    const frontOnlyValidation = evaluateBatchCrossDocumentValidation({
      batchId: "test-batch-front-only",
      segments: frontOnlySegments,
      extractedSegmentData: frontOnlyData,
    });

    const frontDiscrepancies = frontOnlyValidation.learnerDossiers.flatMap((d) => d.discrepancies);
    const missingBackDisc = frontDiscrepancies.find(
      (d) => d.category === "MISSING_DOC" && d.reason.includes("Missing SF9 Back Page / Grades")
    );
    assert.ok(missingBackDisc, "Front-only SF9 must be flagged with MISSING_DOC warning for missing back page");
    assert.equal(missingBackDisc.severity, "WARNING");

    // 3b. Back-only SF9 (Has grades, but no 12-digit LRN / unregistered)
    const backOnlySegments = [
      {
        id: "seg-back-only-1",
        documentType: "sf9",
        pageNumbers: [2],
        pageCount: 1,
        sourceFileName: "orphan_grades_back.jpg",
      },
    ];

    const backOnlyData = {
      "seg-back-only-1": {
        lrn: "UNREGISTERED_SF9_PAGE_2",
        grades: [
          { subject: "Oral Communication", quarter1: 88, quarter2: 90, finalGrade: 89 },
        ],
        general_average: 89,
        is_back_only: true,
      },
    };

    const backOnlyValidation = evaluateBatchCrossDocumentValidation({
      batchId: "test-batch-back-only",
      segments: backOnlySegments,
      extractedSegmentData: backOnlyData,
    });

    const backDiscrepancies = backOnlyValidation.learnerDossiers.flatMap((d) => d.discrepancies);
    const unmatchedBackDisc = backDiscrepancies.find(
      (d) => d.reason.includes("Unmatched SF9 Back Page — Missing Front Page / LRN")
    );
    assert.ok(unmatchedBackDisc, "Back-only SF9 must be flagged with CRITICAL discrepancy");
    assert.equal(unmatchedBackDisc.severity, "CRITICAL");

    // 3c. Identity-conflicted SF9 (Learner A front + Learner B back)
    const conflictSegments = [
      {
        id: "seg-conflict-1",
        documentType: "sf9",
        pageNumbers: [1, 2],
        pageCount: 2,
        sourceFileName: "mismatched_sf9_pair.pdf",
      },
    ];

    const conflictData = {
      "seg-conflict-1": {
        lrn: "109345000001",
        first_name: "CARLOS",
        last_name: "DELA CRUZ",
        identity_conflict: true,
        identity_conflicts: ["LRN mismatch: Front has 109345000001, Back has 109345000099"],
        grades: [], // grades withheld due to mismatch
      },
    };

    const conflictValidation = evaluateBatchCrossDocumentValidation({
      batchId: "test-batch-conflict",
      segments: conflictSegments,
      extractedSegmentData: conflictData,
    });

    const conflictDiscrepancies = conflictValidation.learnerDossiers.flatMap((d) => d.discrepancies);
    const conflictDisc = conflictDiscrepancies.find(
      (d) => d.category === "MISMATCH" && d.field === "SF9 Identity Pairing"
    );
    assert.ok(conflictDisc, "Mismatched front/back pair must be flagged with MISMATCH critical discrepancy");
    assert.equal(conflictDisc.severity, "CRITICAL");
  });

  // ---------------------------------------------------------------------------
  // Test 4: Batch Isolation and Refresh Recovery
  // ---------------------------------------------------------------------------
  await t.test("4. Batch Isolation & Refresh Recovery: Preserves isolated state across batch IDs and re-evaluations", () => {
    const batch1Segments = [
      {
        id: "b1-seg-1",
        documentType: "sf9",
        pageNumbers: [1, 2],
        pageCount: 2,
        sourceFileName: "b1_sf9.pdf",
      },
    ];

    const batch1Data = {
      "b1-seg-1": {
        lrn: "109345000001",
        first_name: "CARLOS",
        last_name: "DELA CRUZ",
        grades: [{ subject: "Oral Communication", finalGrade: 89 }],
      },
    };

    const batch2Segments = [
      {
        id: "b2-seg-1",
        documentType: "sf9",
        pageNumbers: [1, 2],
        pageCount: 2,
        sourceFileName: "b2_sf9.pdf",
      },
    ];

    const batch2Data = {
      "b2-seg-1": {
        lrn: "109345000002",
        first_name: "MARIA",
        last_name: "SANTOS",
        grades: [{ subject: "General Mathematics", finalGrade: 92 }],
      },
    };

    const res1 = evaluateBatchCrossDocumentValidation({
      batchId: "BATCH-ALPHA",
      segments: batch1Segments,
      extractedSegmentData: batch1Data,
    });
    const res2 = evaluateBatchCrossDocumentValidation({
      batchId: "BATCH-BETA",
      segments: batch2Segments,
      extractedSegmentData: batch2Data,
    });

    // Verify isolation
    assert.equal(res1.learnerDossiers.length, 1);
    assert.equal(res1.learnerDossiers[0].lrn, "109345000001");
    assert.equal(res2.learnerDossiers.length, 1);
    assert.equal(res2.learnerDossiers[0].lrn, "109345000002");

    // Re-evaluating BATCH-ALPHA (simulating page refresh recovery)
    const res1Recovery = evaluateBatchCrossDocumentValidation({
      batchId: "BATCH-ALPHA",
      segments: batch1Segments,
      extractedSegmentData: batch1Data,
    });
    assert.equal(res1Recovery.learnerDossiers.length, 1);
    const res1Discs = res1.learnerDossiers.flatMap((d) => d.discrepancies);
    const rec1Discs = res1Recovery.learnerDossiers.flatMap((d) => d.discrepancies);
    assert.equal(rec1Discs.length, res1Discs.length, "Recovery must be strictly idempotent");
    assert.equal(res1Recovery.summary.totalLearnersDetected, 1);
  });
});

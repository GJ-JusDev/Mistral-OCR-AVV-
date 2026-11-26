import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPageContent,
  segmentMultiPageDocument,
  reclassifyDocumentSegment,
  CANONICAL_DOC_ORDER,
  sortSegmentsCanonically,
  buildSegmentsFromPreExtractedPages,
} from "../src/lib/validation/batchDocumentSegmenter.ts";

import {
  evaluateBatchCrossDocumentValidation,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

import {
  evaluateTeacherScanAuthorization,
} from "../src/lib/teacher/assignments.ts";

test("AVV System — Unified Batch Document Scanning, Extraction, and Cross-Document Validation Suite", async (t) => {

  // ---------------------------------------------------------------------------
  // 1. Combined Multi-Page PDF Boundary Segmentation & Classification
  // ---------------------------------------------------------------------------
  await t.test("1. Multi-Page Combined PDF Boundary Identification & Classification", () => {
    // Simulated 11-page combined PDF:
    // Pages 1-3: SF1 School Register
    // Pages 4-5: SF2 Daily Attendance Report
    // Pages 6-7: SF9 Learner Progress Report Card
    // Pages 8-10: SF10 Student Permanent Record
    // Page 11: PSA Certificate of Live Birth
    const mockPages = [
      // SF1 Pages 1-3
      {
        pageNumber: 1,
        text: "Republic of the Philippines\nDepartment of Education\nSchool Form 1 (SF1) School Register\nTrack and Strand: Academic - STEM\nGrade Level: Grade 11 Section: Diamond\nList of Registered Learners\n1. 109345000001 DELA CRUZ, CARLOS M. Male 2008-03-15",
      },
      {
        pageNumber: 2,
        text: "School Form 1 (SF1) School Register (Continuation)\nList of Registered Learners (Page 2 of 3)\n2. 109345000002 SANTOS, MARIA L. Female 2008-07-22",
      },
      {
        pageNumber: 3,
        text: "School Form 1 (SF1) School Register (Continuation)\nList of Registered Learners (Page 3 of 3)\n3. 109345000003 REYES, JOHN P. Male 2007-11-09",
      },
      // SF2 Pages 4-5
      {
        pageNumber: 4,
        text: "Republic of the Philippines\nDepartment of Education\nSchool Form 2 (SF2) Daily Attendance Report of Learners\nFor the Month of: October 2024\nGrade 11 Section: Diamond\nTotal School Days: 22\n1. 109345000001 DELA CRUZ, CARLOS M. Present: 22 Absent: 0 Tardy: 0",
      },
      {
        pageNumber: 5,
        text: "School Form 2 (SF2) Daily Attendance Report (Continuation)\nAverage Daily Attendance: 98%\n2. 109345000002 SANTOS, MARIA L. Present: 20 Absent: 2 Tardy: 1",
      },
      // SF9 Pages 6-7
      {
        pageNumber: 6,
        text: "Republic of the Philippines\nDepartment of Education\nSchool Form 9 (SF9) Learner Progress Report Card\nForm 138 - Senior High School\nLRN: 109345000001 Name: DELA CRUZ, CARLOS MENDOZA\nGrade 11 Section: Diamond Track/Strand: STEM\nCore Subjects: Oral Communication Q1: 88 Q2: 90 Final: 89\nGeneral Mathematics Q1: 85 Q2: 87 Final: 86\nSemestral General Average: 87.5",
      },
      {
        pageNumber: 7,
        text: "School Form 9 (SF9) Front Side\nReport on Attendance\nObserved Values\nDear Parent,\nCertificate of Transfer",
      },
      // SF10 Pages 8-10
      {
        pageNumber: 8,
        text: "Republic of the Philippines\nDepartment of Education\nSchool Form 10 (SF10) Senior High School Student Permanent Record\nForm 137 - SHS Permanent Academic Record\nLearner's Permanent Academic Record\nLRN: 109345000001 Name: DELA CRUZ, CARLOS MENDOZA\nBirth Date: 2008-03-15 Sex: Male\nGrade 11 1st Semester S.Y. 2024-2025\nOral Communication Final: 89\nGeneral Mathematics Final: 86\nGeneral Average: 87.5",
      },
      {
        pageNumber: 9,
        text: "School Form 10 (SF10) Page 2 of 3\nSenior High School Student Permanent Record\nGrade 11 2nd Semester\nStatistics and Probability Final: 88\nPhysical Science Final: 89",
      },
      {
        pageNumber: 10,
        text: "School Form 10 (SF10) Page 3 of 3\nScholastic Record Summary\nEligibility for SHS Enrollment\nRemedial Classes Records",
      },
      // PSA Page 11
      {
        pageNumber: 11,
        text: "Republic of the Philippines\nOffice of the Civil Registrar General\nPhilippine Statistics Authority (PSA)\nNational Statistics Office\nCertificate of Live Birth\nRegistry No: 2008-123456\nChild: CARLOS MENDOZA DELA CRUZ\nDate of Birth: 15 MARCH 2008 Place of Birth: Legazpi City\nMother: MARIA SANTOS MENDOZA Father: JUAN CASTILLO DELA CRUZ",
      },
    ];

    const segments = segmentMultiPageDocument({ pages: mockPages });

    // Must identify exactly 5 document segments (SF1, SF2, SF9, SF10, PSA)
    assert.equal(segments.length, 5, "Must split into exactly 5 distinct document segments");

    // Segment 1: SF1 (Pages 1-3)
    assert.equal(segments[0].documentType, "sf1");
    assert.deepEqual(segments[0].pageNumbers, [1, 2, 3]);
    assert.equal(segments[0].pageCount, 3);

    // Segment 2: SF2 (Pages 4-5)
    assert.equal(segments[1].documentType, "sf2");
    assert.deepEqual(segments[1].pageNumbers, [4, 5]);
    assert.equal(segments[1].pageCount, 2);

    // Segment 3: SF9 (Pages 6-7)
    assert.equal(segments[2].documentType, "sf9");
    assert.deepEqual(segments[2].pageNumbers, [6, 7]);
    assert.equal(segments[2].pageCount, 2);

    // Segment 4: SF10 (Pages 8-10)
    assert.equal(segments[3].documentType, "sf10");
    assert.deepEqual(segments[3].pageNumbers, [8, 9, 10]);
    assert.equal(segments[3].pageCount, 3);

    // Segment 5: PSA (Page 11)
    assert.equal(segments[4].documentType, "birth_cert");
    assert.deepEqual(segments[4].pageNumbers, [11]);
    assert.equal(segments[4].pageCount, 1);
  });

  // ---------------------------------------------------------------------------
  // 2. Ambiguous Page & Needs Classification Handling
  // ---------------------------------------------------------------------------
  await t.test("2. Ambiguous Page Detection as NEEDS_CLASSIFICATION and Teacher Override", () => {
    const ambiguousPage = {
      pageNumber: 1,
      text: "Scanned table snippet without DepEd headers or specific title.\nColumn 1: 109345000001\nColumn 2: Value",
    };

    const classification = classifyPageContent(ambiguousPage.text, ambiguousPage);
    assert.equal(classification.detectedType, "needs_classification");
    assert.equal(classification.needsTeacherReview, true);

    const segments = segmentMultiPageDocument({ pages: [ambiguousPage] });
    assert.equal(segments[0].documentType, "needs_classification");
    assert.equal(segments[0].needsClassification, true);

    // Teacher manually classifies the segment as SF1
    const updatedSegments = reclassifyDocumentSegment(segments, segments[0].id, "sf1");
    assert.equal(updatedSegments[0].documentType, "sf1");
    assert.equal(updatedSegments[0].needsClassification, false);
    assert.equal(updatedSegments[0].confidence, 1.0);
  });

  // ---------------------------------------------------------------------------
  // 3. Multi-Learner Extraction & Full Roster Coverage
  // ---------------------------------------------------------------------------
  await t.test("3. Multi-Learner Roster Extraction Across Multiple Rows", () => {
    const sf1Segment = {
      id: "seg-1-sf1",
      documentType: "sf1",
      formTitle: "SF1-SHS — School Register",
      startPage: 1,
      endPage: 2,
      pageNumbers: [1, 2],
      pageCount: 2,
      combinedText: "",
      confidence: 0.95,
      needsClassification: false,
      reasons: [],
      pages: [],
    };

    const extractedSegmentData = {
      "seg-1-sf1": {
        document_type: "sf1",
        section: "Diamond",
        grade_level: "Grade 11",
        school_year: "2024-2025",
        learners: [
          { lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos", sex: "M", birth_date: "2008-03-15", page_number: 1 },
          { lrn: "109345000002", last_name: "Santos", first_name: "Maria", sex: "F", birth_date: "2008-07-22", page_number: 1 },
          { lrn: "109345000003", last_name: "Reyes", first_name: "John", sex: "M", birth_date: "2007-11-09", page_number: 2 },
        ],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments: [sf1Segment],
      extractedSegmentData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    assert.equal(report.summary.totalLearnersDetected, 3, "Extracts every learner row in the roster, not just row 1");
    assert.equal(report.learnerDossiers[0].lrn, "109345000001");
    assert.equal(report.learnerDossiers[1].lrn, "109345000002");
    assert.equal(report.learnerDossiers[2].lrn, "109345000003");
  });

  // ---------------------------------------------------------------------------
  // 4. Primary 12-Digit LRN Matching (No Name-Only Blind Merging)
  // ---------------------------------------------------------------------------
  await t.test("4. Matching Primarily Through 12-Digit LRN and Rejection of Name-Only Blind Merges", () => {
    const segments = [
      {
        id: "seg-1-sf1",
        documentType: "sf1",
        formTitle: "SF1-SHS",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
      {
        id: "seg-2-sf9",
        documentType: "sf9",
        formTitle: "SF9-SHS",
        startPage: 2,
        endPage: 2,
        pageNumbers: [2],
        pageCount: 1,
        combinedText: "",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
    ];

    // SF1 has "Dela Cruz, Carlos" with LRN 109345000001
    // SF9 has same name "Dela Cruz, Carlos" but DIFFERENT LRN 109345000099
    const extractedData = {
      "seg-1-sf1": {
        learners: [
          { lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos", page_number: 1 },
        ],
      },
      "seg-2-sf9": {
        lrn: "109345000099",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", final: 88 }],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
    });

    // They must NOT be merged into one student based on name alone!
    assert.equal(report.summary.totalLearnersDetected, 2, "Learners with different LRNs must never be merged on name alone");
    assert.ok(report.learnerDossiers.some((d) => d.lrn === "109345000001"));
    assert.ok(report.learnerDossiers.some((d) => d.lrn === "109345000099"));
  });

  // ---------------------------------------------------------------------------
  // 5. Cross-Document Pairwise Comparators Execution
  // ---------------------------------------------------------------------------
  await t.test("5. Pairwise Comparators: SF1 ↔ SF2, SF9 ↔ SF10, and PSA Civil Identity", () => {
    const segments = [
      { id: "s-sf1", documentType: "sf1", pageNumbers: [1], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 1, endPage: 1, formTitle: "SF1" },
      { id: "s-sf2", documentType: "sf2", pageNumbers: [2], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 2, endPage: 2, formTitle: "SF2" },
      { id: "s-sf9", documentType: "sf9", pageNumbers: [3], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 3, endPage: 3, formTitle: "SF9" },
      { id: "s-sf10", documentType: "sf10", pageNumbers: [4], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 4, endPage: 4, formTitle: "SF10" },
      { id: "s-psa", documentType: "birth_cert", pageNumbers: [5], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 5, endPage: 5, formTitle: "PSA" },
    ];

    const extractedData = {
      "s-sf1": {
        learners: [
          { lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos", middle_name: "Mendoza", sex: "M", birth_date: "2008-03-15", page_number: 1 },
        ],
      },
      "s-sf2": {
        attendance_records: [
          { lrn: "109345000001", learner_name: "DELA CRUZ, Carlos", month: "October", total_school_days: 20, days_present: 20, days_absent: 0, days_tardy: 0, page_number: 2 },
        ],
      },
      // SF9 has Oral Communication = 88
      "s-sf9": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", q1: 88, q2: 88, final: 88 }],
        general_average: 88,
      },
      // SF10 has Oral Communication = 85 (Grade Mismatch!)
      "s-sf10": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", final: 85 }],
        general_average: 85,
      },
      // PSA has matching civil birth identity with verified LRN
      "s-psa": {
        lrn: "109345000001",
        identity: {
          lrn: "109345000001",
          last_name: "DELA CRUZ",
          first_name: "CARLOS",
          middle_name: "MENDOZA",
          sex: "M",
          birth_date: "2008-03-15",
          registry_number: "2008-00123",
        },
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
    });

    // Check grade mismatch detected
    assert.equal(report.summary.mismatchedInformationCount >= 1, true, "Must flag grade mismatch between SF9 and SF10");
    const gradeMismatch = report.categorizedResults.mismatchedInformation.find((d) => d.field.toLowerCase().includes("grade"));
    assert.ok(gradeMismatch, "Should record grade discrepancy item");
    assert.equal(gradeMismatch.source1Value, 88);
    assert.equal(gradeMismatch.source2Value, 85);

    // PSA verified without overwriting academic grades
    const dossier = report.learnerDossiers[0];
    assert.equal(dossier.documentPresence.psa, true);
    assert.equal(dossier.documentPresence.sf1, true);
    assert.equal(dossier.documentPresence.sf2, true);
    assert.equal(dossier.documentPresence.sf9, true);
    assert.equal(dossier.documentPresence.sf10, true);
  });

  // ---------------------------------------------------------------------------
  // 6. 6 Canonical User-Specified Categories & Detailed Traceability
  // ---------------------------------------------------------------------------
  await t.test("6. Grouping into the 6 User-Specified Result Categories", () => {
    const segments = [
      { id: "s1", documentType: "sf1", pageNumbers: [1], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 1, endPage: 1, formTitle: "SF1" },
    ];

    const extractedData = {
      s1: {
        learners: [
          // Learner 1: Missing LRN (Incomplete Data)
          { lrn: "", last_name: "Unknown", first_name: "Student", page_number: 1 },
          // Learner 2: Enrolled in SF1 but missing SF2/SF9 (Missing Documents)
          { lrn: "109345000002", last_name: "Santos", first_name: "Maria", page_number: 1 },
        ],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
    });

    assert.ok(report.summary.incompleteDataCount >= 1, "Must categorize missing LRN as Incomplete Data");
    assert.ok(report.summary.missingDocumentsCount >= 1, "Must categorize missing SF2/SF9 as Missing Documents");

    const incompleteItem = report.categorizedResults.incompleteData[0];
    assert.ok(incompleteItem.field, "Must have compared field");
    assert.ok(incompleteItem.reason, "Must have reason");
    assert.ok(incompleteItem.recommendedAction, "Must have recommended action");
  });

  // ---------------------------------------------------------------------------
  // 7. Strict RBAC Enforcement: Only Teachers Can Scan; Admin/Principal Blocked
  // ---------------------------------------------------------------------------
  await t.test("7. Strict RBAC: Only Teachers with Assigned Sections Can Scan (Admin/Principal Blocked)", () => {
    // Teacher with active assignment -> Allowed
    const teacherCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: "teacher-uuid-01",
      accountStatus: "Approved",
      assignment: {
        id: "assign-01",
        teacher_user_id: "teacher-uuid-01",
        assignment_type: "class_adviser",
        assignment_status: "active",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        school_id: "school-01",
      },
      assignmentConfirmed: true,
    });
    assert.equal(teacherCheck.allowed, true);

    // Administrator attempt -> Forbidden
    const adminCheck = evaluateTeacherScanAuthorization({
      userRole: "admin",
      userId: "admin-uuid-01",
      accountStatus: "Approved",
      assignmentConfirmed: true,
    });
    assert.equal(adminCheck.allowed, false);
    assert.equal(adminCheck.statusCode, 403);
    assert.equal(adminCheck.code, "ADMIN_CANNOT_UPLOAD");

    // Principal attempt -> Forbidden
    const principalCheck = evaluateTeacherScanAuthorization({
      userRole: "principal",
      userId: "principal-uuid-01",
      accountStatus: "Approved",
      assignmentConfirmed: true,
    });
    assert.equal(principalCheck.allowed, false);
    assert.equal(principalCheck.statusCode, 403);
    assert.equal(principalCheck.code, "PRINCIPAL_READ_ONLY");
  });

  // ---------------------------------------------------------------------------
  // 8. Idempotent Retry of Failed Segments Without Reprocessing Successful Ones
  // ---------------------------------------------------------------------------
  await t.test("8. Retry of Failed Segment Without Reprocessing Successful Documents", () => {
    const segments = [
      { id: "seg-sf1", documentType: "sf1", pageNumbers: [1], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 1, endPage: 1, formTitle: "SF1" },
      { id: "seg-sf9", documentType: "sf9", pageNumbers: [2], pageCount: 1, combinedText: "", confidence: 1, needsClassification: true, reasons: ["Timeout"], pages: [], startPage: 2, endPage: 2, formTitle: "SF9" },
    ];

    const extractedData = {
      "seg-sf1": { learners: [{ lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos" }] },
      // seg-sf9 previously failed or was empty
    };

    // When seg-sf9 is retried and succeeds:
    const retriedExtractedData = {
      ...extractedData,
      "seg-sf9": { lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos", grades: [{ subject: "Oral Comm", final: 90 }] },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: retriedExtractedData,
    });

    // seg-sf1 remains intact while seg-sf9 is now reconciled
    assert.equal(report.summary.totalLearnersDetected, 1);
    assert.equal(report.learnerDossiers[0].documentPresence.sf1, true);
    assert.equal(report.learnerDossiers[0].documentPresence.sf9, true);
  });

  // ---------------------------------------------------------------------------
  // 9. Canonical Ordering (SF1 -> SF2 -> SF9 -> SF10 -> PSA) & SF9 Presence in Stage B
  // ---------------------------------------------------------------------------
  await t.test("9. Canonical Ordering & Guaranteed Inclusion of SF9 in Stage B", () => {
    // Simulate pre-extracted pages uploaded out of order (e.g. Back uploaded before Front, PSA before SF10)
    const stagedPages = [
      {
        pageNumber: 1,
        documentType: "sf2",
        sourceFileName: "SF2_Oct.pdf",
        text: "School Form 2 Daily Attendance Report Grade 11 Diamond",
        extractedFields: { section: "Diamond", attendance_records: [] },
      },
      {
        pageNumber: 2,
        documentType: "sf9",
        documentSide: "back",
        sourceFileName: "SF9_Back.jpg",
        text: "REPORT ON LEARNING PROGRESS AND ACHIEVEMENT\nOral Communication 88\nGeneral Mathematics 90",
        extractedFields: { grades: [{ subject: "Oral Communication", final: 88 }] },
      },
      {
        pageNumber: 3,
        documentType: "sf1",
        sourceFileName: "SF1_Roster.pdf",
        text: "School Form 1 School Register Grade 11 Diamond 109283746512 DELA CRUZ",
        extractedFields: { section: "Diamond", learners: [{ lrn: "109283746512" }] },
      },
      {
        pageNumber: 4,
        documentType: "sf9",
        documentSide: "front",
        sourceFileName: "SF9_Front.jpg",
        text: "Republic of the Philippines Department of Education\nLearner Reference Number: 109283746512\nREPORT ON ATTENDANCE",
        extractedFields: { lrn: "109283746512", name: "DELA CRUZ, CARLOS" },
      },
      {
        pageNumber: 5,
        documentType: "birth_cert",
        sourceFileName: "PSA_Sideways.jpg",
        sourceFileDataUrl: "data:image/jpeg;base64,raw_sideways_psa",
        upperSectionDataUrl: "data:image/jpeg;base64,upright_preprocessed_psa",
        text: "CERTIFICATE OF LIVE BIRTH CARLOS DELA CRUZ",
        extractedFields: { name: "CARLOS DELA CRUZ" },
      },
      {
        pageNumber: 6,
        documentType: "sf10",
        sourceFileName: "SF10_Record.pdf",
        text: "SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)",
        extractedFields: { lrn: "109283746512" },
      },
    ];

    const segments = buildSegmentsFromPreExtractedPages(stagedPages);

    // 1. Must produce exactly 5 canonical segments (Front & Back SF9 grouped into one)
    assert.equal(segments.length, 5, "Pre-extracted fast-path must unify SF9 into a single segment (5 total segments)");

    // 2. Strict canonical order: SF1 -> SF2 -> SF9 -> SF10 -> birth_cert
    assert.deepEqual(
      segments.map((s) => s.documentType),
      ["sf1", "sf2", "sf9", "sf10", "birth_cert"],
      "Segments must be strictly sorted in canonical sequence: SF1 -> SF2 -> SF9 -> SF10 -> PSA"
    );

    // 3. Sequential IDs match canonical sequence
    assert.deepEqual(
      segments.map((s) => s.id),
      ["seg-1-sf1", "seg-2-sf2", "seg-3-sf9", "seg-4-sf10", "seg-5-birth_cert"],
      "Segment IDs must be sequentially indexed by canonical order"
    );

    // 4. SF9 segment groups both pages with Front placed first
    const sf9Seg = segments.find((s) => s.documentType === "sf9");
    assert.ok(sf9Seg, "SF9 segment must exist");
    assert.equal(sf9Seg.pageCount, 2, "SF9 segment must contain both Front and Back pages");
    assert.equal(sf9Seg.pages[0].documentSide, "front", "SF9 Front side must be ordered first");
    assert.equal(sf9Seg.pages[1].documentSide, "back", "SF9 Back side must be ordered second");

    // 5. PSA segment prioritizes upright preprocessed image
    const psaSeg = segments.find((s) => s.documentType === "birth_cert");
    assert.ok(psaSeg, "PSA segment must exist");
    assert.equal(
      psaSeg.imageUrl,
      "data:image/jpeg;base64,upright_preprocessed_psa",
      "PSA segment must use upright preprocessed image URL instead of raw sideways scan"
    );
  });

  // ---------------------------------------------------------------------------
  // 10. Upright PSA Preview and Clean Parent Names Wrapping in Stage B
  // ---------------------------------------------------------------------------
  await t.test("10. PSA Upright Preview Preservation & Non-Overflowing Parent Names Layout", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const extractionViewPath = path.resolve("src/components/validation/IndividualDocumentExtractionView.tsx");
    const extractionViewSrc = fs.readFileSync(extractionViewPath, "utf-8");

    // Must stack Mother Maiden Name and Father Name on separate lines with break-words
    assert.ok(
      extractionViewSrc.includes("Mother&apos;s Maiden Name:") || extractionViewSrc.includes("Mother's Maiden Name"),
      "Must label Mother's Maiden Name distinctly"
    );
    assert.ok(
      extractionViewSrc.includes("Father&apos;s Name:") || extractionViewSrc.includes("Father's Name"),
      "Must label Father's Name distinctly"
    );
    assert.ok(
      extractionViewSrc.includes("break-words") && extractionViewSrc.includes("whitespace-normal"),
      "Parent names must use break-words and whitespace-normal to prevent horizontal container overflow"
    );

    // Must resolve active section cleanly without defaulting to Unassigned when context is present
    assert.ok(
      extractionViewSrc.includes("activeSection") && extractionViewSrc.includes("contextSection"),
      "Must compute activeSection with contextSection fallback from batch metadata"
    );

    // Must prioritize upright preprocessed PSA image over raw sideways scans
    assert.ok(
      extractionViewSrc.includes("upperSectionDataUrl") || extractionViewSrc.includes("upper_section_data_url"),
      "Must inspect upperSectionDataUrl / processedDataUrl for PSA preview"
    );
  });
});

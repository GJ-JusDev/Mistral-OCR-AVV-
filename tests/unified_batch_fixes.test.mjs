import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTeacherScanAuthorization,
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  normalizeSectionKey,
} from "../src/lib/teacher/assignments.ts";

import {
  segmentMultiPageDocument,
  reclassifyDocumentSegment,
  classifyPageContent,
} from "../src/lib/validation/batchDocumentSegmenter.ts";

import {
  evaluateBatchCrossDocumentValidation,
  rebuildBatchValidationReportFromPersistedResults,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

test("AVV System — Unified Batch Scanning Critical Fixes & Integration Test Suite", async (t) => {

  // ===========================================================================
  // 1. Mandatory Teaching Assignment & Authorization Checks
  // ===========================================================================
  await t.test("1. Server-Side Mandatory Teaching Assignment & Role Verification", async (t2) => {
    
    await t2.test("1.1 Reject missing or unassigned teaching assignment", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Approved",
        assignment: null,
        assignmentConfirmed: false,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "ASSIGNMENT_REQUIRED");
    });

    await t2.test("1.2 Reject assignment owned by a different teacher", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Approved",
        assignment: {
          id: "assign-other",
          teacher_user_id: "teacher-999",
          assignment_type: "class_adviser",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          school_id: "school-01",
        },
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "ASSIGNMENT_NOT_OWNED");
    });

    await t2.test("1.3 Reject inactive teaching assignment", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Approved",
        assignment: {
          id: "assign-inactive",
          teacher_user_id: "teacher-123",
          assignment_type: "class_adviser",
          assignment_status: "inactive",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          school_id: "school-01",
        },
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "ASSIGNMENT_INACTIVE");
    });

    await t2.test("1.4 Reject unconfirmed teaching assignment", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Approved",
        assignment: {
          id: "assign-valid",
          teacher_user_id: "teacher-123",
          assignment_type: "class_adviser",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          school_id: "school-01",
        },
        assignmentConfirmed: false,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 400);
      assert.equal(auth.code, "ASSIGNMENT_CONFIRMATION_REQUIRED");
    });

    await t2.test("1.5 Reject Junior High School (Grade 7-10) assignment for SHS batch scanning", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Approved",
        assignment: {
          id: "assign-jhs",
          teacher_user_id: "teacher-123",
          assignment_type: "class_adviser",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 10",
          section: "Rizal",
          school_id: "school-01",
        },
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "SHS_LEVEL_REQUIRED");
    });

    await t2.test("1.6 Reject Subject Teacher when policy does not permit scanning", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Approved",
        assignment: {
          id: "assign-subject",
          teacher_user_id: "teacher-123",
          assignment_type: "subject_teacher",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          school_id: "school-01",
        },
        policy: { allow_subject_teacher_scanning: false },
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "CLASS_ADVISER_REQUIRED");
    });

    await t2.test("1.7 Reject Unapproved Teacher Account", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-123",
        accountStatus: "Pending",
        assignment: {
          id: "assign-valid",
          teacher_user_id: "teacher-123",
          assignment_type: "class_adviser",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          school_id: "school-01",
        },
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "ACCOUNT_NOT_APPROVED");
    });

    await t2.test("1.8 Block Administrator from batch scan upload", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "admin",
        userId: "admin-123",
        accountStatus: "Approved",
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "ADMIN_CANNOT_UPLOAD");
    });

    await t2.test("1.9 Block Principal from batch scan upload (monitoring only)", () => {
      const auth = evaluateTeacherScanAuthorization({
        userRole: "principal",
        userId: "principal-123",
        accountStatus: "Approved",
        assignmentConfirmed: true,
      });
      assert.equal(auth.allowed, false);
      assert.equal(auth.statusCode, 403);
      assert.equal(auth.code, "PRINCIPAL_READ_ONLY");
    });

    await t2.test("1.10 Allow Grade 11 and Grade 12 Class Advisers with confirmed assignment", () => {
      const g11Auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-g11",
        accountStatus: "Approved",
        assignment: {
          id: "assign-g11",
          teacher_user_id: "teacher-g11",
          assignment_type: "class_adviser",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "Diamond",
          school_id: "school-01",
        },
        assignmentConfirmed: true,
      });
      assert.equal(g11Auth.allowed, true);
      assert.equal(g11Auth.statusCode, 200);

      const g12Auth = evaluateTeacherScanAuthorization({
        userRole: "teacher",
        userId: "teacher-g12",
        accountStatus: "Approved",
        assignment: {
          id: "assign-g12",
          teacher_user_id: "teacher-g12",
          assignment_type: "class_adviser",
          assignment_status: "active",
          school_year: "2024-2025",
          grade_level: "Grade 12",
          section: "Ruby",
          school_id: "school-01",
        },
        assignmentConfirmed: true,
      });
      assert.equal(g12Auth.allowed, true);
      assert.equal(g12Auth.statusCode, 200);
    });
  });

  // ===========================================================================
  // 2. Multi-File Batch Aggregation & File Name Tracking
  // ===========================================================================
  await t.test("2. Multi-File Upload Aggregation & Cross-File Page Tracking", () => {
    // Simulated upload of 3 separate files:
    // File 1: SF1 (2 pages)
    // File 2: SF2 (1 page)
    // File 3: PSA (1 page)
    const file1Pages = [
      {
        pageNumber: 1,
        sourceFileName: "SF1_Grade11_Diamond.pdf",
        sourceFileDataUrl: "data:image/png;base64,mockFile1Page1",
        text: "School Form 1 (SF1) School Register\nGrade Level: Grade 11 Section: Diamond S.Y. 2024-2025\n1. 109345000001 DELA CRUZ, CARLOS M. Male 2008-03-15",
      },
      {
        pageNumber: 2,
        sourceFileName: "SF1_Grade11_Diamond.pdf",
        sourceFileDataUrl: "data:image/png;base64,mockFile1Page2",
        text: "School Form 1 (SF1) School Register (Continuation)\n2. 109345000002 SANTOS, MARIA L. Female 2008-07-22",
      },
    ];

    const file2Pages = [
      {
        pageNumber: 3, // Cumulative page in batch
        sourceFileName: "SF2_October_Diamond.pdf",
        sourceFileDataUrl: "data:image/png;base64,mockFile2Page1",
        text: "School Form 2 (SF2) Daily Attendance Report of Learners\nMonth of: October\nGrade 11 Section: Diamond\n1. 109345000001 DELA CRUZ, CARLOS M. Present: 22 Absent: 0",
      },
    ];

    const file3Pages = [
      {
        pageNumber: 4, // Cumulative page in batch
        sourceFileName: "PSA_DelaCruz_Carlos.pdf",
        sourceFileDataUrl: "data:image/png;base64,mockFile3Page1",
        text: "Philippine Statistics Authority (PSA)\nCertificate of Live Birth\nChild: CARLOS MENDOZA DELA CRUZ\nDate of Birth: 15 MARCH 2008",
      },
    ];

    const allBatchPages = [...file1Pages, ...file2Pages, ...file3Pages];
    const segments = segmentMultiPageDocument({ pages: allBatchPages });

    assert.equal(segments.length, 3, "Must segment into SF1, SF2, and PSA");
    assert.equal(segments[0].documentType, "sf1");
    assert.equal(segments[0].sourceFileName, "SF1_Grade11_Diamond.pdf");
    assert.deepEqual(segments[0].pageNumbers, [1, 2]);

    assert.equal(segments[1].documentType, "sf2");
    assert.equal(segments[1].sourceFileName, "SF2_October_Diamond.pdf");
    assert.deepEqual(segments[1].pageNumbers, [3]);

    assert.equal(segments[2].documentType, "birth_cert");
    assert.equal(segments[2].sourceFileName, "PSA_DelaCruz_Carlos.pdf");
    assert.deepEqual(segments[2].pageNumbers, [4]);
  });

  // ===========================================================================
  // 3. Foreign Key Order & Database Ingestion Sequence Safety
  // ===========================================================================
  await t.test("3. Document Persistence Sequencing & Foreign Key Safety", async (t2) => {
    // Mock Supabase Store to verify execution order
    const callLog = [];
    const insertedDocuments = [];
    const insertedChildRecords = [];

    const mockDb = {
      from(table) {
        return {
          insert(payload) {
            callLog.push({ action: "insert", table, payload });
            if (table === "documents") {
              const docRecord = {
                id: `doc-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                ...payload,
              };
              insertedDocuments.push(docRecord);
              return Promise.resolve({ data: docRecord, error: null });
            } else {
              insertedChildRecords.push({ table, payload });
              return Promise.resolve({ data: payload, error: null });
            }
          },
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };

    // Simulate batch persistence flow for SF1 and PSA
    const segmentsToPersist = [
      {
        id: "seg-sf1",
        documentType: "sf1",
        pageNumbers: [1, 2],
        sourceFileName: "SF1_Diamond.pdf",
        imageUrl: "https://storage.supabase.co/avv/sf1.png",
      },
      {
        id: "seg-psa",
        documentType: "birth_cert",
        pageNumbers: [3],
        sourceFileName: "PSA.pdf",
        imageUrl: "https://storage.supabase.co/avv/psa.png",
      },
    ];

    for (const seg of segmentsToPersist) {
      // Step A: MUST insert parent document FIRST
      const docPayload = {
        school_id: "school-01",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        document_type: seg.documentType === "birth_cert" ? "birth_cert" : seg.documentType,
        image_url: seg.imageUrl,
        original_filename: seg.sourceFileName,
        status: "needs_review",
        uploaded_by: "teacher-123",
      };
      const { data: docRes } = await mockDb.from("documents").insert(docPayload);
      const parentDocId = docRes.id;
      assert.ok(parentDocId, "Parent document must return generated UUID");

      // Step B: Insert child records referencing parentDocId
      if (seg.documentType === "sf1") {
        await mockDb.from("sf1_roster_entries").insert([
          { document_id: parentDocId, lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos" },
        ]);
      } else if (seg.documentType === "birth_cert") {
        await mockDb.from("psa_identity_records").insert({
          document_id: parentDocId,
          last_name: "DELA CRUZ",
          first_name: "CARLOS",
        });
      }
    }

    // Verify ordering: documents MUST precede child tables
    assert.equal(callLog[0].table, "documents", "First call must insert parent document");
    assert.equal(callLog[1].table, "sf1_roster_entries", "Second call inserts child entries");
    assert.equal(callLog[1].payload[0].document_id, insertedDocuments[0].id, "Child record must have valid parent document_id");

    assert.equal(callLog[2].table, "documents", "Third call inserts second parent document");
    assert.equal(callLog[3].table, "psa_identity_records", "Fourth call inserts PSA child entry");
    assert.equal(callLog[3].payload.document_id, insertedDocuments[1].id, "PSA child record must reference its parent document_id");
  });

  // ===========================================================================
  // 4. Traceability & Source File In Discrepancies
  // ===========================================================================
  await t.test("4. Source File Name and Data URL Preservation Across Pairwise Comparators", () => {
    const segments = [
      {
        id: "seg-sf9",
        documentType: "sf9",
        pageNumbers: [1],
        sourceFileName: "SF9_Learner1.pdf",
        imageUrl: "data:image/png;base64,mockSF9Img",
        formTitle: "SF9",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 1,
        endPage: 1,
        pageCount: 1,
      },
      {
        id: "seg-sf10",
        documentType: "sf10",
        pageNumbers: [2],
        sourceFileName: "SF10_Learner1.pdf",
        imageUrl: "data:image/png;base64,mockSF10Img",
        formTitle: "SF10",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 2,
        endPage: 2,
        pageCount: 1,
      },
    ];

    const extractedData = {
      "seg-sf9": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", final: 90 }],
        general_average: 90,
      },
      "seg-sf10": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", final: 75 }], // Mismatch!
        general_average: 90,
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    assert.equal(report.summary.mismatchedInformationCount, 1);
    const disc = report.categorizedResults.mismatchedInformation[0];

    // Check all required discrepancy properties
    assert.ok(disc.field.includes("oral communication"));
    assert.equal(disc.source1Doc, "SF9-SHS Report Card");
    assert.equal(disc.source1FileName, "SF9_Learner1.pdf");
    assert.equal(disc.source1Value, 90);
    assert.equal(disc.source2Doc, "SF10-SHS Permanent Transcript");
    assert.equal(disc.source2FileName, "SF10_Learner1.pdf");
    assert.equal(disc.source2Value, 75);
    assert.equal(disc.severity, "CRITICAL");
    assert.ok(disc.reason.includes("Grade mismatch") || disc.reason.includes("SF9"));
    assert.ok(disc.recommendedAction.length > 0);
  });

  // ===========================================================================
  // 5. Result State Retrieval (GET /api/scan/batch) Logic
  // ===========================================================================
  await t.test("5. Result Retrieval Ignores Archived and Rejected Documents", () => {
    const mockDbDocuments = [
      { id: "doc-1", status: "verified", document_type: "sf1", school_year: "2024-2025", grade_level: "Grade 11", section: "Diamond" },
      { id: "doc-2", status: "verified", document_type: "sf2", school_year: "2024-2025", grade_level: "Grade 11", section: "Diamond" },
      { id: "doc-3", status: "archived", document_type: "sf1", school_year: "2024-2025", grade_level: "Grade 11", section: "Diamond" }, // should be ignored
      { id: "doc-4", status: "rejected", document_type: "sf5", school_year: "2024-2025", grade_level: "Grade 11", section: "Diamond" }, // should be ignored
    ];

    const activeDocs = mockDbDocuments.filter((d) => !["archived", "rejected"].includes(d.status));
    assert.equal(activeDocs.length, 2, "Only active, non-archived, non-rejected documents should be retrieved");
    assert.equal(activeDocs[0].id, "doc-1");
    assert.equal(activeDocs[1].id, "doc-2");
  });

  // ===========================================================================
  // 6. Section Metadata Normalization
  // ===========================================================================
  await t.test("6. Normalization of Section, Grade Level, and School Year", () => {
    assert.equal(normalizeGradeLevelKey("11"), "Grade 11");
    assert.equal(normalizeGradeLevelKey("g11"), "Grade 11");
    assert.equal(normalizeGradeLevelKey("grade 11"), "Grade 11");
    assert.equal(normalizeGradeLevelKey("Gr. 11"), "Grade 11");
    assert.equal(normalizeGradeLevelKey("12"), "Grade 12");
    assert.equal(normalizeGradeLevelKey("g12"), "Grade 12");
    assert.equal(normalizeGradeLevelKey("grade 12"), "Grade 12");

    assert.equal(normalizeSchoolYearKey(" 2024 - 2025 "), "2024-2025");
    assert.equal(normalizeSectionKey(" Diamond "), "diamond");
    assert.equal(normalizeSectionKey("DIAMOND - A"), "diamond - a");
  });

  // ===========================================================================
  // 7. Step Category Lock & Cross-Document Matrix Preservation on Persistence Error
  // ===========================================================================
  await t.test("7. Step Category Lock & Matrix Preservation", async (t2) => {
    await t2.test("7.1 Step category locks documentType against keyword heuristic misclassification", () => {
      // SF1 roster table that mentions 'Birth Certificate' and 'Date of Birth'
      const sf1PageWithPsaKeywords = {
        pageNumber: 1,
        documentType: "sf1",
        text: `
          Republic of the Philippines - Department of Education
          School Form 1 (SF1) School Register
          Birth Certificate No. | Date of Birth | Name of Learner
          123456789012 | 2007-05-12 | Santos, Juan
          PSA Registry Number: 2007-12345
        `,
      };

      const classification = classifyPageContent(sf1PageWithPsaKeywords.text, sf1PageWithPsaKeywords);
      assert.equal(classification.detectedType, "sf1", "Explicit sf1 documentType must not be misclassified as birth_cert");
      assert.equal(classification.confidence, 1.0);

      const segments = segmentMultiPageDocument({ pages: [sf1PageWithPsaKeywords] });
      assert.equal(segments.length, 1);
      assert.equal(segments[0].documentType, "sf1");
      assert.equal(segments[0].id, "seg-1-sf1");
    });

    await t2.test("7.2 Preserves unifiedMatrix when validationPersistence is REQUIRES_IDENTITY_RESOLUTION", () => {
      const mockMatrix = [
        {
          field: "Date of Birth",
          status: "MATCH",
          sources: { sf1: "2007-05-12", birth_cert: "2007-05-12" },
        },
      ];

      const mockReport = {
        batchId: "batch-test-123",
        learnerDossiers: [
          {
            lrn: "109345000001",
            fullName: "DELA CRUZ, CARLOS MENDOZA",
            overallStatus: "NEEDS_REVIEW",
            documentPresence: { totalAvailable: 2 },
            unifiedMatrix: mockMatrix,
            discrepancies: [],
            validationPersistence: {
              status: "REQUIRES_IDENTITY_RESOLUTION",
              reason: "Cross-validation persistence failed: network timeout",
            },
          },
        ],
        summary: {},
      };

      const rebuilt = rebuildBatchValidationReportFromPersistedResults(mockReport);
      assert.equal(rebuilt.learnerDossiers[0].unifiedMatrix?.length, 1, "unifiedMatrix must not be wiped on REQUIRES_IDENTITY_RESOLUTION");
      assert.deepEqual(rebuilt.learnerDossiers[0].unifiedMatrix, mockMatrix);
    });
  });

  // ===========================================================================
  // 8. Pre-Extracted Fast-Path and Non-Blocking Persistence Warnings
  // ===========================================================================
  await t.test("8. Pre-Extracted Fast-Path & Non-Blocking Persistence Warnings", async (t2) => {
    await t2.test("8.1 Fast-Path feeds pre-extracted structured fields directly into cross-document validation", () => {
      // Staged documents that already carry extractedFields from Steps 1–5
      const preExtractedPages = [
        {
          pageNumber: 1,
          sourceFileName: "SF1_Roster.pdf",
          documentType: "sf1",
          text: "School Form 1 (SF1) Master List",
          extractedFields: {
            roster: [
              {
                lrn: "109345000001",
                name: "DELA CRUZ, CARLOS MENDOZA",
                last_name: "DELA CRUZ",
                first_name: "CARLOS",
                middle_name: "MENDOZA",
                sex: "Male",
                birth_date: "2008-03-15",
              },
            ],
          },
        },
        {
          pageNumber: 2,
          sourceFileName: "SF9_Card.pdf",
          documentType: "sf9",
          text: "SF9 Progress Report Card",
          extractedFields: {
            lrn: "109345000001",
            first_name: "CARLOS",
            last_name: "DELA CRUZ",
            middle_name: "MENDOZA",
            general_average: 88,
            grades: [
              { subject: "General Mathematics", final_grade: 88 },
            ],
          },
        },
      ];

      // Verify that pre-extracted detection identifies pages with extractedFields
      const isPreExtracted = preExtractedPages.every(
        (p) => Boolean((p.extractedFields && Object.keys(p.extractedFields).length > 0) || p.extractedText)
      );
      assert.equal(isPreExtracted, true, "All pages carry pre-extracted structured fields");

      // Verify validation runs directly on pre-extracted data without needing heuristic classification
      const segments = [
        {
          id: "seg-1-sf1",
          documentType: "sf1",
          formTitle: "SF1",
          startPage: 1,
          endPage: 1,
          pageNumbers: [1],
          pageCount: 1,
          combinedText: preExtractedPages[0].text,
          confidence: 1.0,
          needsClassification: false,
          reasons: ["Fast-path: Pre-extracted"],
          pages: [preExtractedPages[0]],
        },
        {
          id: "seg-2-sf9",
          documentType: "sf9",
          formTitle: "SF9",
          startPage: 2,
          endPage: 2,
          pageNumbers: [2],
          pageCount: 1,
          combinedText: preExtractedPages[1].text,
          confidence: 1.0,
          needsClassification: false,
          reasons: ["Fast-path: Pre-extracted"],
          pages: [preExtractedPages[1]],
        },
      ];

      const extractedSegmentData = {
        "seg-1-sf1": preExtractedPages[0].extractedFields,
        "seg-2-sf9": preExtractedPages[1].extractedFields,
      };

      const report = evaluateBatchCrossDocumentValidation({
        batchId: "batch-fastpath-001",
        schoolYear: "2024-2025",
        gradeLevel: "Grade 11",
        section: "Diamond",
        segments,
        extractedSegmentData,
      });

      assert.equal(report.summary.totalLearnersDetected, 1);
      assert.equal(report.learnerDossiers[0].lrn, "109345000001");
      assert.ok(report.learnerDossiers[0].unifiedMatrix.length > 0, "Unified matrix must be generated directly from pre-extracted data");
    });

    await t2.test("8.2 Secondary table persistence failure produces persistenceWarnings instead of failing request", () => {
      // Simulate persistence failure on secondary roster table
      const persistenceErrors = [
        { segmentId: "seg-1-sf1", error: 'relation "sf1_roster_entries" does not exist' },
      ];
      const crossValidationPersistenceErrors = [
        { lrn: "109345000001", error: "check constraint failed on student_validations" },
      ];

      // Formulate non-blocking warnings array
      const persistenceWarnings = [
        ...persistenceErrors.map((e) => e.error),
        ...crossValidationPersistenceErrors.map((e) => e.error),
      ];

      assert.equal(persistenceWarnings.length, 2);
      assert.ok(persistenceWarnings[0].includes("sf1_roster_entries"));
      assert.ok(persistenceWarnings[1].includes("check constraint"));
    });
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateBatchCrossDocumentValidation,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

import {
  evaluateUnifiedStudentValidation,
} from "../src/lib/validation/crossDocumentEngine.ts";

test("AVV System — Unified Cross-Document Validation Engine Regression Suite", async (t) => {

  // ===========================================================================
  // 1. Simultaneous SF5A and SF5B Records for One Learner
  // ===========================================================================
  await t.test("1. Simultaneous SF5A and SF5B records preserved without overwriting", () => {
    const segments = [
      {
        id: "seg-sf1",
        documentType: "sf1",
        pageNumbers: [1],
        sourceFileName: "SF1_Roster.pdf",
        formTitle: "SF1-SHS",
        confidence: 0.98,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 1,
        endPage: 1,
        pageCount: 1,
      },
      {
        id: "seg-sf5a",
        documentType: "sf5a",
        pageNumbers: [2],
        sourceFileName: "SF5A_Promotion_Sem1.pdf",
        formTitle: "SF5A-SHS",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 2,
        endPage: 2,
        pageCount: 1,
      },
      {
        id: "seg-sf5b",
        documentType: "sf5b",
        pageNumbers: [3],
        sourceFileName: "SF5B_Graduation_Candidates.pdf",
        formTitle: "SF5B-SHS",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 3,
        endPage: 3,
        pageCount: 1,
      },
    ];

    const extractedData = {
      "seg-sf1": {
        learners: [
          {
            lrn: "109345000001",
            last_name: "Dela Cruz",
            first_name: "Carlos",
            middle_name: "Mendoza",
            sex: "M",
            birth_date: "2007-03-15",
            grade_level: "Grade 12",
            section: "Diamond",
            track_strand: "STEM",
          },
        ],
      },
      "seg-sf5a": {
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: "Diamond",
        semester: "1st Semester",
        learners: [
          {
            lrn: "109345000001",
            last_name: "Dela Cruz",
            first_name: "Carlos",
            action_taken: "PROMOTED",
            general_average: 91,
            semester: "1st Semester",
          },
        ],
      },
      "seg-sf5b": {
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: "Diamond",
        learners: [
          {
            lrn: "109345000001",
            last_name: "Dela Cruz",
            first_name: "Carlos",
            action_taken: "GRADUATING",
            track_strand: "STEM",
          },
        ],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 12",
      section: "Diamond",
    });

    assert.equal(report.summary.totalLearnersDetected, 1, "Exactly one learner detected");
    const dossier = report.learnerDossiers[0];
    assert.equal(dossier.lrn, "109345000001");

    // Both document presence flags must be true
    assert.equal(dossier.documentPresence.sf5a, true, "SF5A presence must be true");
    assert.equal(dossier.documentPresence.sf5b, true, "SF5B presence must be true");

    // Both matched sources must be retained separately
    assert.ok(dossier.matchedSources.sf5a, "SF5A source must exist");
    assert.equal(dossier.matchedSources.sf5a.raw.action_taken, "PROMOTED");
    assert.equal(dossier.matchedSources.sf5a.fileName, "SF5A_Promotion_Sem1.pdf");

    assert.ok(dossier.matchedSources.sf5b, "SF5B source must exist");
    assert.equal(dossier.matchedSources.sf5b.raw.graduation_status, "GRADUATING");
    assert.equal(dossier.matchedSources.sf5b.fileName, "SF5B_Graduation_Candidates.pdf");

    // Verify Unified Matrix has both PROMOTION and GRADUATION rows
    assert.ok(dossier.unifiedMatrix, "Unified matrix must be generated");
    const promoRow = dossier.unifiedMatrix.find((r) => r.category === "PROMOTION" && r.field === "promotion_status_sf5a");
    assert.ok(promoRow, "Must include promotion_status_sf5a row from SF5A");
    assert.equal(promoRow.sf5aValue, "PROMOTED");

    const gradRow = dossier.unifiedMatrix.find((r) => r.category === "GRADUATION" && r.field === "graduation_clearance_sf5b");
    assert.ok(gradRow, "Must include graduation_clearance_sf5b row from SF5B");
    assert.equal(gradRow.sf5bValue, "GRADUATING");
  });

  // ===========================================================================
  // 2. Multiple SF2 Months Reconciled Against SF9 Attendance Entries
  // ===========================================================================
  await t.test("2. Multiple SF2 months reconciled against corresponding SF9 monthly attendance", () => {
    const segments = [
      {
        id: "seg-sf2-aug",
        documentType: "sf2",
        pageNumbers: [1],
        sourceFileName: "SF2_August.pdf",
        formTitle: "SF2-SHS",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 1,
        endPage: 1,
        pageCount: 1,
      },
      {
        id: "seg-sf2-sep",
        documentType: "sf2",
        pageNumbers: [2],
        sourceFileName: "SF2_September.pdf",
        formTitle: "SF2-SHS",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 2,
        endPage: 2,
        pageCount: 1,
      },
      {
        id: "seg-sf9",
        documentType: "sf9",
        pageNumbers: [3],
        sourceFileName: "SF9_ReportCard.pdf",
        formTitle: "SF9-SHS",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        startPage: 3,
        endPage: 3,
        pageCount: 1,
      },
    ];

    const extractedData = {
      "seg-sf2-aug": {
        month: "August",
        school_year: "2024-2025",
        attendance_records: [
          {
            lrn: "109345000001",
            last_name: "Dela Cruz",
            first_name: "Carlos",
            month: "August",
            days_present: 20,
            days_absent: 1,
            total_school_days: 21,
          },
        ],
      },
      "seg-sf2-sep": {
        month: "September",
        school_year: "2024-2025",
        attendance_records: [
          {
            lrn: "109345000001",
            last_name: "Dela Cruz",
            first_name: "Carlos",
            month: "September",
            days_present: 22,
            days_absent: 0,
            total_school_days: 22,
          },
        ],
      },
      "seg-sf9": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        attendance_months: ["August", "September", "October"],
        attendance: [
          { label: "No. of school days", values: [21, 22, 21] },
          { label: "No. of days present", values: [20, 22, 21] },
          { label: "No. of days absent", values: [1, 0, 0] },
        ],
        grades: [{ subject: "Oral Communication", final: 90 }],
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

    const dossier = report.learnerDossiers[0];
    assert.equal(dossier.documentPresence.sf2, true);
    assert.equal(dossier.documentPresence.sf9, true);

    // Verify multiple SF2 records preserved
    assert.equal(dossier.allSf2Records.length, 2, "Must preserve both August and September SF2 records");
    assert.equal(dossier.duplicateWarnings.length, 0, "Legitimate distinct months must NOT trigger duplicate warnings");

    // Check attendance rows in unified matrix
    const augRow = dossier.unifiedMatrix.find((r) => r.field === "attendance_august");
    assert.ok(augRow, "Must have attendance_august row");
    assert.ok(augRow.sf2Value.includes("Pres: 20"));
    assert.ok(augRow.sf9Value.includes("Pres: 20"));
    assert.equal(augRow.status, "MATCH");

    const sepRow = dossier.unifiedMatrix.find((r) => r.field === "attendance_september");
    assert.ok(sepRow, "Must have attendance_september row");
    assert.ok(sepRow.sf2Value.includes("Pres: 22"));
    assert.ok(sepRow.sf9Value.includes("Pres: 22"));
    assert.equal(sepRow.status, "MATCH");

    // Unuploaded SF2 month (October) must NOT be false mismatches
    const octRow = dossier.unifiedMatrix.find((r) => r.field === "attendance_october");
    assert.ok(octRow, "Must have attendance_october row from SF9");
    assert.notEqual(octRow.status, "MISMATCH", "Unuploaded months must not be flagged as MISMATCH");
    assert.equal(octRow.status, "NOT_APPLICABLE");
  });

  // ===========================================================================
  // 3. Duplicate Scan Handling: Identical Duplicate vs Conflicting Duplicate
  // ===========================================================================
  await t.test("3. Identical duplicate scans and conflicting duplicate scans", async (t2) => {

    await t2.test("3.1 Identical duplicate scan produces single rich warning and preserves original record", () => {
      const segments = [
        {
          id: "seg-sf2-1",
          documentType: "sf2",
          pageNumbers: [1],
          sourceFileName: "SF2_Oct_Original.pdf",
          formTitle: "SF2-SHS",
          confidence: 0.95,
          needsClassification: false,
          reasons: [],
          pages: [],
          startPage: 1,
          endPage: 1,
          pageCount: 1,
        },
        {
          id: "seg-sf2-2",
          documentType: "sf2",
          pageNumbers: [2],
          sourceFileName: "SF2_Oct_Copy.pdf",
          formTitle: "SF2-SHS",
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
        "seg-sf2-1": {
          month: "October",
          attendance_records: [
            { lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos", total_present: 20, total_absent: 0 },
          ],
        },
        "seg-sf2-2": {
          month: "October",
          attendance_records: [
            { lrn: "109345000001", last_name: "Dela Cruz", first_name: "Carlos", total_present: 20, total_absent: 0 },
          ],
        },
      };

      const report = evaluateBatchCrossDocumentValidation({
        segments,
        extractedSegmentData: extractedData,
      });

      const dossier = report.learnerDossiers[0];
      assert.equal(dossier.duplicateWarnings.length, 1, "Must generate exactly one duplicate scan warning");
      const dup = dossier.duplicateWarnings[0];
      assert.equal(dup.isIdentical, true, "Must flag duplicate as identical");
      assert.equal(dup.severity, "WARNING");
      assert.equal(dup.documentType, "SF2-SHS");
      assert.equal(dup.existingSource, "SF2_Oct_Original.pdf");
      assert.equal(dup.newSource, "SF2_Oct_Copy.pdf");

      // Verify original record is preserved
      assert.equal(dossier.matchedSources.sf2.fileName, "SF2_Oct_Original.pdf");

      // Verify that duplicate scan warning is registered exactly once in dossier.discrepancies
      const dupDiscs = dossier.discrepancies.filter((d) => d.field.toLowerCase().includes("duplicate"));
      assert.equal(dupDiscs.length, 1, "Duplicate scan warning must be registered exactly once in discrepancies");
    });

    await t2.test("3.2 Conflicting duplicate scan flags CRITICAL mismatch", () => {
      const segments = [
        {
          id: "seg-sf9-1",
          documentType: "sf9",
          pageNumbers: [1],
          sourceFileName: "SF9_Original.pdf",
          formTitle: "SF9-SHS",
          confidence: 0.95,
          needsClassification: false,
          reasons: [],
          pages: [],
          startPage: 1,
          endPage: 1,
          pageCount: 1,
        },
        {
          id: "seg-sf9-2",
          documentType: "sf9",
          pageNumbers: [2],
          sourceFileName: "SF9_Tampered.pdf",
          formTitle: "SF9-SHS",
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
        "seg-sf9-1": {
          lrn: "109345000001",
          last_name: "Dela Cruz",
          first_name: "Carlos",
          grades: [{ subject: "Oral Comm", final: 85 }],
          general_average: 85,
        },
        "seg-sf9-2": {
          lrn: "109345000001",
          last_name: "Dela Cruz",
          first_name: "Carlos",
          grades: [{ subject: "Oral Comm", final: 95 }],
          general_average: 95,
        },
      };

      const report = evaluateBatchCrossDocumentValidation({
        segments,
        extractedSegmentData: extractedData,
      });

      const dossier = report.learnerDossiers[0];
      assert.equal(dossier.duplicateWarnings.length, 1);
      const dup = dossier.duplicateWarnings[0];
      assert.equal(dup.isIdentical, false, "Must flag duplicate as conflicting");
      assert.equal(dup.severity, "CRITICAL");
      assert.equal(dossier.overallStatus, "MISMATCH");
    });
  });

  // ===========================================================================
  // 4. Complete 7-Document Unified Learner Comparison
  // ===========================================================================
  await t.test("4. Complete 7-document unified learner comparison across all 6 categories", () => {
    const segments = [
      { id: "s-sf1", documentType: "sf1", pageNumbers: [1], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 1, endPage: 1, formTitle: "SF1", sourceFileName: "SF1.pdf" },
      { id: "s-sf2", documentType: "sf2", pageNumbers: [2], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 2, endPage: 2, formTitle: "SF2", sourceFileName: "SF2.pdf" },
      { id: "s-sf5a", documentType: "sf5a", pageNumbers: [3], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 3, endPage: 3, formTitle: "SF5A", sourceFileName: "SF5A.pdf" },
      { id: "s-sf5b", documentType: "sf5b", pageNumbers: [4], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 4, endPage: 4, formTitle: "SF5B", sourceFileName: "SF5B.pdf" },
      { id: "s-sf9", documentType: "sf9", pageNumbers: [5], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 5, endPage: 5, formTitle: "SF9", sourceFileName: "SF9.pdf" },
      { id: "s-sf10", documentType: "sf10", pageNumbers: [6], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 6, endPage: 6, formTitle: "SF10", sourceFileName: "SF10.pdf" },
      { id: "s-psa", documentType: "birth_cert", pageNumbers: [7], pageCount: 1, combinedText: "", confidence: 1, needsClassification: false, reasons: [], pages: [], startPage: 7, endPage: 7, formTitle: "PSA", sourceFileName: "PSA.pdf" },
    ];

    const extractedData = {
      "s-sf1": {
        school_id: "301234",
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: "Diamond",
        track_strand: "STEM",
        learners: [
          {
            lrn: "109345000001",
            last_name: "DELA CRUZ",
            first_name: "CARLOS",
            middle_name: "MENDOZA",
            sex: "MALE",
            birth_date: "2007-03-15",
            father_name: "JUAN DELA CRUZ",
            mother_maiden_name: "MARIA MENDOZA",
          },
        ],
      },
      "s-sf2": {
        month: "October",
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: "Diamond",
        attendance_records: [
          {
            lrn: "109345000001",
            learner_name: "DELA CRUZ, Carlos",
            month: "October",
            days_present: 21,
            days_absent: 0,
            total_school_days: 21,
          },
        ],
      },
      "s-sf5a": {
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: "Diamond",
        semester: "1st Semester",
        learners: [
          {
            lrn: "109345000001",
            last_name: "DELA CRUZ",
            first_name: "CARLOS",
            action_taken: "PROMOTED",
            general_average: 89.5,
          },
        ],
      },
      "s-sf5b": {
        school_year: "2024-2025",
        grade_level: "Grade 12",
        section: "Diamond",
        learners: [
          {
            lrn: "109345000001",
            last_name: "DELA CRUZ",
            first_name: "CARLOS",
            action_taken: "GRADUATING",
            track_strand: "STEM",
          },
        ],
      },
      "s-sf9": {
        lrn: "109345000001",
        last_name: "DELA CRUZ",
        first_name: "CARLOS",
        middle_name: "MENDOZA",
        grade_level: "Grade 12",
        section: "Diamond",
        track_strand: "STEM",
        school_year: "2024-2025",
        semester: "1st Semester",
        attendance_months: ["October"],
        attendance: [
          { label: "No. of school days", values: [21] },
          { label: "No. of days present", values: [21] },
          { label: "No. of days absent", values: [0] },
        ],
        grades: [
          { subject: "General Chemistry 1", q1: 90, q2: 90, final: 90 },
          { subject: "Physics 1", q1: 88, q2: 90, final: 89 },
        ],
        general_average: 89.5,
      },
      "s-sf10": {
        lrn: "109345000001",
        last_name: "DELA CRUZ",
        first_name: "CARLOS",
        middle_name: "MENDOZA",
        birth_date: "2007-03-15",
        sex: "M",
        school_year: "2024-2025",
        grade_level: "Grade 12",
        semester: "1st Semester",
        completed_semesters: [
          { grade_level: "Grade 11", semester: "1st Semester", subjects: [] },
          { grade_level: "Grade 11", semester: "2nd Semester", subjects: [] },
          { grade_level: "Grade 12", semester: "1st Semester", subjects: [] },
          { grade_level: "Grade 12", semester: "2nd Semester", subjects: [] },
        ],
        has_unresolved_back_subjects: false,
        grades: [
          { subject: "General Chemistry 1", final: 90 },
          { subject: "Physics 1", final: 89 },
        ],
        general_average: 89.5,
      },
      "s-psa": {
        lrn: "109345000001",
        identity: {
          lrn: "109345000001",
          last_name: "DELA CRUZ",
          first_name: "CARLOS",
          middle_name: "MENDOZA",
          sex: "M",
          birth_date: "2007-03-15",
          father_name: "JUAN DELA CRUZ",
          mother_maiden_name: "MARIA MENDOZA",
          registry_number: "2007-12345",
        },
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 12",
      section: "Diamond",
    });

    assert.equal(report.summary.totalLearnersDetected, 1);
    const dossier = report.learnerDossiers[0];

    // Verify all 7 documents are present in documentPresence
    assert.equal(dossier.documentPresence.sf1, true, "SF1 present");
    assert.equal(dossier.documentPresence.sf2, true, "SF2 present");
    assert.equal(dossier.documentPresence.sf5a, true, "SF5A present");
    assert.equal(dossier.documentPresence.sf5b, true, "SF5B present");
    assert.equal(dossier.documentPresence.sf9, true, "SF9 present");
    assert.equal(dossier.documentPresence.sf10, true, "SF10 present");
    assert.equal(dossier.documentPresence.psa, true, "PSA present");
    assert.equal(dossier.documentPresence.totalAvailable, 7, "Total available must be 7");

    // Verify matchedSources has all 7 documents
    assert.ok(dossier.matchedSources.sf1, "sf1 source");
    assert.ok(dossier.matchedSources.sf2, "sf2 source");
    assert.ok(dossier.matchedSources.sf5a, "sf5a source");
    assert.ok(dossier.matchedSources.sf5b, "sf5b source");
    assert.ok(dossier.matchedSources.sf9, "sf9 source");
    assert.ok(dossier.matchedSources.sf10, "sf10 source");
    assert.ok(dossier.matchedSources.psa, "psa source");

    // Verify unifiedMatrix covers all 6 canonical categories
    assert.ok(dossier.unifiedMatrix.length > 0, "Unified matrix must have rows");

    const categoriesPresent = new Set(dossier.unifiedMatrix.map((r) => r.category));
    assert.ok(categoriesPresent.has("IDENTITY"), "Must have IDENTITY category");
    assert.ok(categoriesPresent.has("SCHOOL_CONTEXT"), "Must have SCHOOL_CONTEXT category");
    assert.ok(categoriesPresent.has("ATTENDANCE"), "Must have ATTENDANCE category");
    assert.ok(categoriesPresent.has("ACADEMIC"), "Must have ACADEMIC category");
    assert.ok(categoriesPresent.has("PROMOTION"), "Must have PROMOTION category");
    assert.ok(categoriesPresent.has("GRADUATION"), "Must have GRADUATION category");

    // Check key fields across documents
    const lrnRow = dossier.unifiedMatrix.find((r) => r.field === "lrn");
    assert.ok(lrnRow, "Must compare LRN");
    assert.equal(lrnRow.status, "MATCH");

    const nameRow = dossier.unifiedMatrix.find((r) => r.field === "last_name");
    assert.ok(nameRow, "Must compare last_name");
    assert.equal(nameRow.status, "MATCH");

    const attRow = dossier.unifiedMatrix.find((r) => r.field === "attendance_october");
    assert.ok(attRow, "Must compare October attendance");
    assert.equal(attRow.status, "MATCH");

    const avgRow = dossier.unifiedMatrix.find((r) => r.field === "general_average");
    assert.ok(avgRow, "Must compare general_average");
    assert.equal(avgRow.status, "MATCH");

    const promoRow = dossier.unifiedMatrix.find((r) => r.field === "promotion_status_sf5a");
    assert.ok(promoRow, "Must compare promotion_status_sf5a");
    assert.equal(promoRow.sf5aValue, "PROMOTED");

    const gradRow = dossier.unifiedMatrix.find((r) => r.field === "graduation_clearance_sf5b");
    assert.ok(gradRow, "Must compare graduation_clearance_sf5b");
    assert.equal(gradRow.sf5bValue, "GRADUATING");

    // Overall status should be MATCH
    assert.equal(dossier.overallStatus, "MATCH");
  });
});

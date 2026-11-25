/**
 * AVV System — Unified Document-by-Document Extraction & Multi-Stage Workflow Test Suite
 *
 * Verifies:
 * 1. Multiple uploaded documents extraction across SF1, SF2, SF5A, SF5B, SF9, SF10, and PSA.
 * 2. Multi-learner rows extraction from SF1, SF2, SF5A, SF5B with row index, page number, and bounding boxes.
 * 3. Individual document extraction visibility and non-silent error handling.
 * 4. LRN-based matching across SF1, SF9, and SF10 with strict rejection of name-only merges.
 * 5. Name conflicts and missing LRN identity resolution quarantine.
 * 6. Multiple SF9/SF10 records and duplicate scan differentiation.
 * 7. Complete unified comparison across all available documents (missing = incomplete coverage, not mismatch).
 * 8. Full source traceability (document ID, page, row, bounding box).
 * 9. Persisted results recovery after page refresh.
 * 10. Multi-stage navigation and presentation (Stages A, B, C, D, E).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateBatchCrossDocumentValidation,
  rebuildBatchValidationReportFromPersistedResults,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";
import { segmentMultiPageDocument } from "../src/lib/validation/batchDocumentSegmenter.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

describe("AVV — Unified Document-by-Document Extraction Output & Multi-Stage Suite", () => {
  // Test 1: Multiple Uploaded Documents Extraction
  test("1. Multiple uploaded documents extracted individually with document type and metadata", () => {
    const pages = [
      {
        pageNumber: 1,
        sourceFileName: "Batch_Roster_And_Attendance.pdf",
        text: `DEPARTMENT OF EDUCATION
School Form 1 (SF1) School Register for Senior High School
School ID: 500169 School Name: Taysan Resettlement Integrated School
School Year: 2024-2025 Grade Level: Grade 11 Section: Diamond
Track: Academic Strand: General Academic Strand (GAS)
LRN\tName\tSex\tBirth Date
109876543210\tDELA CRUZ, JUAN SANTOS\tM\t2007-05-15
109876543211\tSANTOS, MARIA CLARA\tF\t2007-08-20`,
      },
      {
        pageNumber: 2,
        sourceFileName: "Batch_Roster_And_Attendance.pdf",
        text: `School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 500169 School Year: 2024-2025 Grade Level: Grade 11 Section: Diamond Month: August
| LRN | Learner Name | Present | Absent | Tardy |
| 109876543210 | DELA CRUZ, JUAN SANTOS | 21 | 1 | 0 |
| 109876543211 | SANTOS, MARIA CLARA | 22 | 0 | 0 |`,
      },
      {
        pageNumber: 3,
        sourceFileName: "SF9_Card_Juan.pdf",
        text: `School Form 9 (SF9) Progress Report Card
LRN: 109876543210
Name: DELA CRUZ, JUAN SANTOS
Grade: Grade 11 Section: Diamond School Year: 2024-2025 Semester: 1st Semester
| Subjects | Q1 | Q2 | Final | Remarks |
| Oral Communication | 88 | 90 | 89 | PASSED |
| General Mathematics | 85 | 87 | 86 | PASSED |
General Average: 87.5`,
      },
    ];

    const segments = segmentMultiPageDocument({ pages, fallbackDocType: "sf9" });
    assert.equal(segments.length, 3, "Expected 3 distinct document segments");

    assert.equal(segments[0].documentType, "sf1");
    assert.equal(segments[0].pageNumbers[0], 1);
    assert.equal(segments[0].sourceFileName, "Batch_Roster_And_Attendance.pdf");

    assert.equal(segments[1].documentType, "sf2");
    assert.equal(segments[1].pageNumbers[0], 2);
    assert.equal(segments[1].sourceFileName, "Batch_Roster_And_Attendance.pdf");

    assert.equal(segments[2].documentType, "sf9");
    assert.equal(segments[2].pageNumbers[0], 3);
    assert.equal(segments[2].sourceFileName, "SF9_Card_Juan.pdf");

    // Extract each segment individually
    const extractedData = {};
    for (const seg of segments) {
      extractedData[seg.id] = parseGradesText(seg.combinedText, "Grade 11", undefined, seg.documentType);
      assert.ok(extractedData[seg.id], `Segment ${seg.id} must have extracted data`);
      assert.equal(extractedData[seg.id].document_type, seg.documentType);
    }

    // Verify SF1 extracted multi-learner rows
    assert.equal(extractedData[segments[0].id].learners.length, 2);
    assert.equal(extractedData[segments[0].id].learners[0].lrn, "109876543210");
    assert.equal(extractedData[segments[0].id].learners[1].lrn, "109876543211");

    // Verify SF2 extracted attendance rows
    assert.equal(extractedData[segments[1].id].attendance_records.length, 2);
    assert.equal(extractedData[segments[1].id].attendance_records[0].lrn, "109876543210");

    // Verify SF9 extracted grades
    assert.equal(extractedData[segments[2].id].lrn, "109876543210");
    assert.ok(extractedData[segments[2].id].grades.length >= 2);
  });

  // Test 2: Multi-Learner Roster Rows with Row Index, Page Number, and Bounding Box
  test("2. Extracts every learner row from multi-learner documents preserving row numbers and traceability", () => {
    const sf1Layout = {
      pages: [
        {
          pageNumber: 1,
          lines: [],
          tables: [
            {
              _pageNumber: 1,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "Name" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "Birth Date" },
                { rowIndex: 1, columnIndex: 0, content: "123456789001", polygon: [10, 10, 50, 10, 50, 20, 10, 20] },
                { rowIndex: 1, columnIndex: 1, content: "ALVAREZ, ALBERTO B.", polygon: [55, 10, 120, 10, 120, 20, 55, 20] },
                { rowIndex: 1, columnIndex: 2, content: "M" },
                { rowIndex: 1, columnIndex: 3, content: "2007-01-10" },
                { rowIndex: 2, columnIndex: 0, content: "123456789002", polygon: [10, 25, 50, 25, 50, 35, 10, 35] },
                { rowIndex: 2, columnIndex: 1, content: "BAUTISTA, BERNARDO C.", polygon: [55, 25, 120, 25, 120, 35, 55, 35] },
                { rowIndex: 2, columnIndex: 2, content: "M" },
                { rowIndex: 2, columnIndex: 3, content: "2007-02-14" },
                { rowIndex: 3, columnIndex: 0, content: "123456789003", polygon: [10, 40, 50, 40, 50, 50, 10, 50] },
                { rowIndex: 3, columnIndex: 1, content: "CASTRO, CLAUDIA D.", polygon: [55, 40, 120, 40, 120, 50, 55, 50] },
                { rowIndex: 3, columnIndex: 2, content: "F" },
                { rowIndex: 3, columnIndex: 3, content: "2007-03-22" },
              ],
            },
          ],
        },
      ],
    };

    const parsedSf1 = parseGradesText(
      "School Form 1 (SF1) School Register Grade 11 Section Diamond",
      "Grade 11",
      sf1Layout,
      "sf1"
    );

    assert.equal(parsedSf1.learners.length, 3, "All 3 learner rows must be extracted");
    assert.equal(parsedSf1.learners[0].row_index, 1);
    assert.equal(parsedSf1.learners[0].lrn, "123456789001");
    assert.equal(parsedSf1.learners[0].page_number, 1);
    assert.ok(Array.isArray(parsedSf1.learners[0].bounding_box));

    assert.equal(parsedSf1.learners[1].row_index, 2);
    assert.equal(parsedSf1.learners[1].lrn, "123456789002");
    assert.equal(parsedSf1.learners[2].row_index, 3);
    assert.equal(parsedSf1.learners[2].lrn, "123456789003");
  });

  // Test 3: Individual Document Extraction Visibility & Error Preservation
  test("3. Preserves failed or incomplete extraction results and displays errors per document", () => {
    const segments = [
      {
        id: "seg-good",
        documentType: "sf1",
        formTitle: "School Register (SF1-SHS)",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "SF1 valid text",
        confidence: 0.96,
        needsClassification: false,
        reasons: [],
        pages: [],
        persistenceStatus: "persisted",
        sourceFileName: "SF1_Good.pdf",
      },
      {
        id: "seg-bad",
        documentType: "sf9",
        formTitle: "Progress Report Card (SF9-SHS)",
        startPage: 2,
        endPage: 2,
        pageNumbers: [2],
        pageCount: 1,
        combinedText: "Unreadable corrupted document content",
        confidence: 0.42,
        needsClassification: true,
        reasons: ["Low OCR confidence"],
        pages: [],
        persistenceStatus: "failed",
        persistenceError: "Unreadable text: unable to parse grade table",
        sourceFileName: "SF9_Corrupt.pdf",
      },
    ];

    const extractedData = {
      "seg-good": {
        document_type: "sf1",
        learners: [{ lrn: "111222333444", last_name: "GARCIA", first_name: "ANA" }],
      },
      "seg-bad": {
        document_type: "sf9",
        error: "Unreadable text: unable to parse grade table",
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    // Failed document must be retained in report.segments with its failure status
    const badSegInReport = report.segments.find((s) => s.id === "seg-bad");
    assert.ok(badSegInReport, "Failed segment must not be silently discarded");
    assert.equal(badSegInReport.persistenceStatus, "failed");
    assert.equal(badSegInReport.persistenceError, "Unreadable text: unable to parse grade table");
  });

  // Test 4: Identity Matching Priority (LRN as primary, Name as secondary, NEVER name alone)
  test("4. LRN-based matching across SF1, SF9, and SF10 with strict rejection of name-only merging", () => {
    const segments = [
      {
        id: "seg-sf1",
        documentType: "sf1",
        formTitle: "SF1-SHS",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "SF1 text",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
      {
        id: "seg-sf9",
        documentType: "sf9",
        formTitle: "SF9-SHS",
        startPage: 2,
        endPage: 2,
        pageNumbers: [2],
        pageCount: 1,
        combinedText: "SF9 text",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
    ];

    // Case: Learner A and Learner B share the EXACT SAME name ("CRUZ, JUAN") but have DIFFERENT LRNs!
    const extractedData = {
      "seg-sf1": {
        document_type: "sf1",
        learners: [
          { lrn: "111111111111", last_name: "CRUZ", first_name: "JUAN" },
          { lrn: "222222222222", last_name: "CRUZ", first_name: "JUAN" },
        ],
      },
      "seg-sf9": {
        document_type: "sf9",
        lrn: "111111111111",
        last_name: "CRUZ",
        first_name: "JUAN",
        grades: [{ subject: "Oral Communication", final: 88 }],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    // They MUST NOT be merged because their LRNs differ!
    assert.equal(report.learnerDossiers.length, 2, "Must produce 2 distinct dossiers for differing LRNs despite identical name");
    const d1 = report.learnerDossiers.find((d) => d.lrn === "111111111111");
    const d2 = report.learnerDossiers.find((d) => d.lrn === "222222222222");

    assert.ok(d1 && d2, "Both distinct LRNs must exist");
    assert.ok(d1.matchedSources.sf9, "Learner 111111111111 must match SF9");
    assert.equal(d2.matchedSources.sf9, undefined, "Learner 222222222222 must NOT receive SF9 by name alone");
  });

  // Test 5: Missing LRN Identity Resolution Quarantine
  test("5. Quarantines records with missing or invalid LRN under identity resolution", () => {
    const segments = [
      {
        id: "seg-sf1",
        documentType: "sf1",
        formTitle: "SF1-SHS",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "SF1",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
    ];

    const extractedData = {
      "seg-sf1": {
        document_type: "sf1",
        learners: [
          { lrn: "", last_name: "UNREGISTERED", first_name: "STUDENT" }, // Blank LRN
          { lrn: "12345", last_name: "MALFORMED", first_name: "LRN" },   // Non-12-digit LRN
        ],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    assert.equal(report.learnerDossiers.length, 2);
    for (const d of report.learnerDossiers) {
      assert.ok(
        d.discrepancies.some((disc) => disc.category === "INCOMPLETE_DATA" && disc.field.includes("LRN")),
        "Must flag missing/invalid LRN discrepancy"
      );
    }
  });

  // Test 6: Multiple SF9/SF10 Records & Duplicate Scan Differentiation
  test("6. Detects multiple SF9 records, distinguishing identical scans from conflicting grades", () => {
    const segments = [
      {
        id: "seg-sf9-1",
        documentType: "sf9",
        formTitle: "SF9 Scan 1",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "SF9",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        sourceFileName: "SF9_Front.pdf",
      },
      {
        id: "seg-sf9-2",
        documentType: "sf9",
        formTitle: "SF9 Scan 2",
        startPage: 2,
        endPage: 2,
        pageNumbers: [2],
        pageCount: 1,
        combinedText: "SF9",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        sourceFileName: "SF9_Duplicate.pdf",
      },
    ];

    // Case 6A: Identical duplicate scan
    const extractedIdentical = {
      "seg-sf9-1": {
        document_type: "sf9",
        lrn: "123456789012",
        last_name: "TEST",
        first_name: "LEARNER",
        general_average: 88,
        grades: [{ subject: "English", final: 88 }],
      },
      "seg-sf9-2": {
        document_type: "sf9",
        lrn: "123456789012",
        last_name: "TEST",
        first_name: "LEARNER",
        general_average: 88,
        grades: [{ subject: "English", final: 88 }],
      },
    };

    const reportIdentical = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedIdentical,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    const dIdentical = reportIdentical.learnerDossiers[0];
    assert.equal(dIdentical.allSf9Records.length, 2);
    assert.ok(dIdentical.duplicateWarnings.length > 0);
    assert.equal(dIdentical.duplicateWarnings[0].isIdentical, true);
    assert.equal(dIdentical.duplicateWarnings[0].severity, "WARNING");

    // Case 6B: Conflicting duplicate scan with differing grades
    const extractedConflicting = {
      "seg-sf9-1": {
        document_type: "sf9",
        lrn: "123456789012",
        last_name: "TEST",
        first_name: "LEARNER",
        general_average: 88,
        grades: [{ subject: "English", final: 88 }],
      },
      "seg-sf9-2": {
        document_type: "sf9",
        lrn: "123456789012",
        last_name: "TEST",
        first_name: "LEARNER",
        general_average: 74, // Conflicting average!
        grades: [{ subject: "English", final: 74 }],
      },
    };

    const reportConflicting = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedConflicting,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    const dConflicting = reportConflicting.learnerDossiers[0];
    assert.ok(dConflicting.duplicateWarnings.length > 0);
    assert.equal(dConflicting.duplicateWarnings[0].isIdentical, false);
    assert.equal(dConflicting.duplicateWarnings[0].severity, "CRITICAL");
  });

  // Test 7: Complete Unified Comparison across ALL documents (SF1, SF2, SF5A, SF5B, SF9, SF10, PSA)
  test("7. Compares complete 7-document set together and classifies missing documents as incomplete coverage", () => {
    const segments = [
      { id: "s1", documentType: "sf1", pageNumbers: [1], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
      { id: "s2", documentType: "sf2", pageNumbers: [2], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
      { id: "s5a", documentType: "sf5a", pageNumbers: [3], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
      { id: "s5b", documentType: "sf5b", pageNumbers: [4], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
      { id: "s9", documentType: "sf9", pageNumbers: [5], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
      { id: "s10", documentType: "sf10", pageNumbers: [6], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
      { id: "psa", documentType: "birth_cert", pageNumbers: [7], pageCount: 1, combinedText: "", confidence: 0.95, needsClassification: false, reasons: [], pages: [] },
    ];

    const lrn = "123456789099";
    const extractedData = {
      s1: { document_type: "sf1", learners: [{ lrn, last_name: "DELA CRUZ", first_name: "JUAN", sex: "M", birth_date: "2007-05-15" }] },
      s2: { document_type: "sf2", attendance_records: [{ lrn, last_name: "DELA CRUZ", first_name: "JUAN", total_present: 20, total_absent: 0 }] },
      s5a: { document_type: "sf5a", learners: [{ lrn, last_name: "DELA CRUZ", first_name: "JUAN", action_taken: "PROMOTED" }] },
      s5b: { document_type: "sf5b", learners: [{ lrn, last_name: "DELA CRUZ", first_name: "JUAN", graduation_status: "GRADUATED" }] },
      s9: { document_type: "sf9", lrn, last_name: "DELA CRUZ", first_name: "JUAN", general_average: 88, grades: [{ subject: "English", final: 88 }] },
      s10: { document_type: "sf10", lrn, last_name: "DELA CRUZ", first_name: "JUAN", general_average: 88, grades: [{ subject: "English", final: 88 }] },
      psa: { document_type: "birth_cert", lrn, identity: { last_name: "DELA CRUZ", first_name: "JUAN", sex: "M", birth_date: "2007-05-15", registry_number: "2007-12345" } },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 12",
      section: "Diamond",
    });

    assert.equal(report.learnerDossiers.length, 1);
    const d = report.learnerDossiers[0];
    assert.equal(d.documentPresence.totalAvailable, 7, "All 7 document types must be present");
    assert.equal(d.documentPresence.sf1, true);
    assert.equal(d.documentPresence.sf2, true);
    assert.equal(d.documentPresence.sf5a, true);
    assert.equal(d.documentPresence.sf5b, true);
    assert.equal(d.documentPresence.sf9, true);
    assert.equal(d.documentPresence.sf10, true);
    assert.equal(d.documentPresence.psa, true);

    // Verify missing document classification on an incomplete learner (e.g. only SF1 present)
    const reportSingle = evaluateBatchCrossDocumentValidation({
      segments: [segments[0]],
      extractedSegmentData: { s1: extractedData.s1 },
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    const dSingle = reportSingle.learnerDossiers[0];
    assert.equal(dSingle.overallStatus, "INCOMPLETE", "Missing forms must result in INCOMPLETE coverage, not automatic mismatch");
    assert.ok(dSingle.discrepancies.some((disc) => disc.category === "MISSING_DOC"));
  });

  // Test 8: Source Traceability (Page, Row, Document ID)
  test("8. Source page, row numbers, and document references are preserved across comparison results", () => {
    const segments = [
      {
        id: "doc-psa-uuid",
        documentType: "birth_cert",
        formTitle: "PSA Birth Certificate",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        sourceFileName: "Civil_PSA.pdf",
      },
      {
        id: "doc-sf1-uuid",
        documentType: "sf1",
        formTitle: "SF1",
        startPage: 2,
        endPage: 2,
        pageNumbers: [2],
        pageCount: 1,
        combinedText: "",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        sourceFileName: "Enrollment_SF1.pdf",
      },
    ];

    const extractedData = {
      "doc-psa-uuid": {
        document_type: "birth_cert",
        lrn: "123456789012",
        identity: {
          last_name: "DELA CRUZ",
          first_name: "JUAN",
          birth_date: "2007-05-15",
          registry_number: "2007-9999",
        },
      },
      "doc-sf1-uuid": {
        document_type: "sf1",
        learners: [
          {
            lrn: "123456789012",
            last_name: "DELA CRUZ",
            first_name: "JUAN",
            birth_date: "2007-06-20", // Conflicting birth date!
            row_index: 3,
            page_number: 2,
          },
        ],
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    const d = report.learnerDossiers[0];
    assert.equal(d.matchedSources.psa.pageNumber, 1);
    assert.equal(d.matchedSources.psa.fileName, "Civil_PSA.pdf");

    assert.equal(d.matchedSources.sf1.pageNumber, 2);
    assert.equal(d.matchedSources.sf1.raw?.row_index, 3);
    assert.equal(d.matchedSources.sf1.fileName, "Enrollment_SF1.pdf");

    // The birth date discrepancy must retain the source filenames and pages
    const birthDisc = d.discrepancies.find((disc) => disc.field.toLowerCase().includes("birth"));
    assert.ok(birthDisc, "Must find birth date discrepancy");
    assert.equal(birthDisc.source1FileName, "Civil_PSA.pdf");
    assert.equal(birthDisc.source1Page, 1);
    assert.equal(birthDisc.source2FileName, "Enrollment_SF1.pdf");
    assert.equal(birthDisc.source2Page, 2);
  });

  // Test 9: Persisted Results Recovery & Rebuilding
  test("9. Persisted validation report is rebuilt accurately from database state upon page refresh", () => {
    const segments = [
      {
        id: "seg-1",
        documentId: "db-doc-1",
        documentType: "sf1",
        formTitle: "SF1",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
        persistenceStatus: "persisted",
      },
    ];

    const extractedData = {
      "seg-1": {
        document_type: "sf1",
        learners: [{ lrn: "123456789012", last_name: "SANTOS", first_name: "MARIA" }],
      },
    };

    const initialReport = evaluateBatchCrossDocumentValidation({
      segments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    // Simulate database persistence
    const dossier = initialReport.learnerDossiers[0];
    dossier.validationPersistence = {
      status: "PERSISTED",
      consolidatedValidationId: "consolidation-uuid-99",
      persistedStatus: "MATCH",
    };
    dossier.overallStatus = "MATCH";

    // Rebuild report from persisted results
    const rebuiltReport = rebuildBatchValidationReportFromPersistedResults(initialReport);

    assert.equal(rebuiltReport.validationSource, "PERSISTED");
    assert.equal(rebuiltReport.summary.persistedValidationCount, 1);
    assert.equal(rebuiltReport.learnerDossiers[0].validationPersistence?.status, "PERSISTED");
    assert.equal(rebuiltReport.learnerDossiers[0].overallStatus, "MATCH");
  });

  // Test 10: Component Verification for Stages A through E
  test("10. Verified existence of Stages A, B, C, D, and E in UI components", () => {
    const uploadPagePath = path.join(ROOT, "src/app/upload/page.tsx");
    const resultsViewPath = path.join(ROOT, "src/components/validation/UnifiedBatchResultsView.tsx");
    const individualExtractionPath = path.join(ROOT, "src/components/validation/IndividualDocumentExtractionView.tsx");
    const identityMatchingPath = path.join(ROOT, "src/components/validation/LearnerIdentityMatchingView.tsx");

    assert.ok(fs.existsSync(uploadPagePath), "src/app/upload/page.tsx must exist");
    assert.ok(fs.existsSync(resultsViewPath), "UnifiedBatchResultsView.tsx must exist");
    assert.ok(fs.existsSync(individualExtractionPath), "IndividualDocumentExtractionView.tsx must exist");
    assert.ok(fs.existsSync(identityMatchingPath), "LearnerIdentityMatchingView.tsx must exist");

    const resultsCode = fs.readFileSync(resultsViewPath, "utf8");
    assert.ok(resultsCode.includes("stage_a"), "Must support Stage A");
    assert.ok(resultsCode.includes("stage_b"), "Must support Stage B");
    assert.ok(resultsCode.includes("stage_c"), "Must support Stage C");
    assert.ok(resultsCode.includes("stage_d"), "Must support Stage D");
    assert.ok(resultsCode.includes("stage_e"), "Must support Stage E");
    assert.ok(resultsCode.includes("IndividualDocumentExtractionView"), "Must render IndividualDocumentExtractionView");
    assert.ok(resultsCode.includes("LearnerIdentityMatchingView"), "Must render LearnerIdentityMatchingView");

    const uploadCode = fs.readFileSync(uploadPagePath, "utf8");
    assert.ok(uploadCode.includes("initialStage=\"stage_b\""), "Upload page must default to Stage B after scanning");
    assert.ok(uploadCode.includes("extractedData={extractedData}"), "Upload page must pass extractedData");
    assert.ok(uploadCode.includes("segments={detectedSegments}"), "Upload page must pass detectedSegments");
  });
});

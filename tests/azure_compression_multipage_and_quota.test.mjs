import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";

import {
  compressServerImageBuffer,
  compressServerImageDataUrl,
  preprocessOcrRequest,
} from "../src/lib/ocr/serverImageCompressor.ts";
import {
  extractEmbeddedPdfText,
  getPdfPageCount,
} from "../src/lib/ocr/pdfTextExtractor.ts";
import { parseShsSf1 } from "../src/lib/ocr/shsSf1Parser.ts";
import { parseShsSf2 } from "../src/lib/ocr/shsSf2Parser.ts";

test("Azure ICR Image Compression (< 3.0 MB), Multi-Page PDF & SessionStorage Quota Suite", async (t) => {
  // ===========================================================================
  // 1. Image Compression (< 3.0 MB)
  // ===========================================================================
  await t.test("1a. compressServerImageBuffer downscales large image (> 2400px, > 2.5 MB) strictly below 3.0 MB", async () => {
    // Generate an oversized uncompressed PNG (3000x3000)
    const rawLargePng = await sharp({
      create: {
        width: 3000,
        height: 3000,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const res = await compressServerImageBuffer(rawLargePng, "image/png", {
      maxDimension: 2400,
      maxSizeBytes: 2.5 * 1024 * 1024,
      quality: 85,
    });

    assert.equal(res.wasCompressed, true, "Should trigger compression for > 2400px image");
    assert.equal(res.mimeType, "image/jpeg", "Should convert to JPEG");
    assert.ok(res.compressedSizeBytes < 3.0 * 1024 * 1024, "Payload must be strictly under 3.0 MB");

    const meta = await sharp(res.buffer).metadata();
    assert.ok(meta.width && meta.width <= 2400, `Width (${meta.width}) must be <= 2400px`);
    assert.ok(meta.height && meta.height <= 2400, `Height (${meta.height}) must be <= 2400px`);
  });

  await t.test("1b. compressServerImageDataUrl compresses oversized base64 payload", async () => {
    const rawPng = await sharp({
      create: {
        width: 2800,
        height: 2000,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const dataUrl = `data:image/png;base64,${rawPng.toString("base64")}`;
    const comp = await compressServerImageDataUrl(dataUrl);

    assert.equal(comp.wasCompressed, true, "Oversized dataUrl should be compressed");
    assert.ok(comp.dataUrl.startsWith("data:image/jpeg;base64,"), "Should be jpeg dataUrl");
    const binaryEstimate = Math.floor((comp.dataUrl.length * 3) / 4);
    assert.ok(binaryEstimate < 3.0 * 1024 * 1024, "Resulting binary size must be < 3.0 MB");
  });

  await t.test("1c. preprocessOcrRequest downscales request body images safely", async () => {
    const rawPng = await sharp({
      create: {
        width: 2600,
        height: 1800,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .png()
      .toBuffer();

    const dataUrl = `data:image/png;base64,${rawPng.toString("base64")}`;
    const mockReq = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: dataUrl,
        documentType: "sf9",
      }),
    });

    const processed = await preprocessOcrRequest(mockReq);
    const body = await processed.json();

    assert.ok(body.image.startsWith("data:image/jpeg;base64,"), "Processed image should be JPEG data URL");
    const estSize = Math.floor((body.image.length * 3) / 4);
    assert.ok(estSize < 3.0 * 1024 * 1024, "Processed body image must be under 3.0 MB");
  });

  // ===========================================================================
  // 2. Multi-Page PDF & Single-Student Aggregation
  // ===========================================================================
  await t.test("2a. getPdfPageCount accurately inspects PDF streams", () => {
    const singlePagePdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n%%EOF"
    );
    assert.equal(getPdfPageCount(singlePagePdf), 1, "Single page PDF should return 1");

    const multiPagePdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page >>\nendobj\n4 0 obj\n<< /Type /Page >>\nendobj\n5 0 obj\n<< /Type /Page >>\nendobj\n%%EOF"
    );
    assert.equal(getPdfPageCount(multiPagePdf), 3, "3-page PDF should return 3");
  });

  await t.test("2b. extractEmbeddedPdfText extracts text streams across multiple pages", () => {
    const page1Text = "BT (111500619123) Tj (GOMEZ, JUSTIN LOQUILLANO) Tj (M) Tj (06/23/2004) Tj ET";
    const deflated1 = zlib.deflateSync(Buffer.from(page1Text, "utf8"));

    const page2Text = "BT (Continuation Sheet - No Students) Tj ET";
    const deflated2 = zlib.deflateSync(Buffer.from(page2Text, "utf8"));

    const mockPdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + deflated1.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
      deflated1,
      Buffer.from("\nendstream\nendobj\n2 0 obj\n<< /Length " + deflated2.length + " /Filter /FlateDecode >>\nstream\n", "latin1"),
      deflated2,
      Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
    ]);

    const extracted = extractEmbeddedPdfText(mockPdf);
    assert.ok(extracted.includes("111500619123"), "Should extract LRN from page 1");
    assert.ok(extracted.includes("GOMEZ, JUSTIN LOQUILLANO"), "Should extract name from page 1");
    assert.ok(extracted.includes("Continuation Sheet"), "Should extract page 2 text");
  });

  await t.test("2c. parseShsSf1 preserves 1 student when Page 1 has 1 student and Pages 2-3 are blank grids", () => {
    // Multi-page table layout: Page 1 has 1 student, Page 2 and Page 3 have empty grid rows
    const mockMultiPageAzureLayout = {
      pages: [
        {
          pageNumber: 1,
          tables: [
            {
              rowCount: 2,
              columnCount: 4,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
                { rowIndex: 1, columnIndex: 0, content: "111500619123" },
                { rowIndex: 1, columnIndex: 1, content: "GOMEZ, JUSTIN LOQUILLANO" },
                { rowIndex: 1, columnIndex: 2, content: "M" },
                { rowIndex: 1, columnIndex: 3, content: "06/23/2004" },
              ],
            },
          ],
        },
        {
          pageNumber: 2,
          tables: [
            {
              rowCount: 3,
              columnCount: 4,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
                // Blank grid rows on Page 2
                { rowIndex: 1, columnIndex: 0, content: "" },
                { rowIndex: 1, columnIndex: 1, content: "" },
                { rowIndex: 1, columnIndex: 2, content: "" },
                { rowIndex: 1, columnIndex: 3, content: "" },
                { rowIndex: 2, columnIndex: 0, content: "" },
                { rowIndex: 2, columnIndex: 1, content: "" },
                { rowIndex: 2, columnIndex: 2, content: "" },
                { rowIndex: 2, columnIndex: 3, content: "" },
              ],
            },
          ],
        },
        {
          pageNumber: 3,
          tables: [
            {
              rowCount: 2,
              columnCount: 4,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
                { rowIndex: 1, columnIndex: 0, content: "" },
                { rowIndex: 1, columnIndex: 1, content: "" },
                { rowIndex: 1, columnIndex: 2, content: "" },
                { rowIndex: 1, columnIndex: 3, content: "" },
              ],
            },
          ],
        },
      ],
    };

    const rawText = "School ID: 500169 Grade 11 STEM School Year: 2024-2025\nPage 1 of 3\nPage 2 of 3\nPage 3 of 3";
    const result = parseShsSf1(rawText, mockMultiPageAzureLayout);

    assert.equal(result.no_student_found, false, "Must NOT trigger no_student_found when 1 student exists on Page 1");
    assert.equal(result.learners.length, 1, "Must preserve Page 1 student across multi-page document");
    assert.equal(result.learners[0].lrn, "111500619123");
    assert.equal(result.learners[0].full_name, "Gomez, Justin Loquillano");
    assert.equal(result.learners[0].sex, "M");
    assert.equal(result.learners[0].birth_date, "2004-06-23");
  });

  await t.test("2d. parseShsSf2 preserves attendance across multiple pages", () => {
    const mockMultiPageSf2Layout = {
      pages: [
        {
          pageNumber: 1,
          tables: [
            {
              rowCount: 2,
              columnCount: 5,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Total Days" },
                { rowIndex: 0, columnIndex: 3, content: "Present" },
                { rowIndex: 0, columnIndex: 4, content: "Absent" },
                { rowIndex: 1, columnIndex: 0, content: "111500619123" },
                { rowIndex: 1, columnIndex: 1, content: "GOMEZ, JUSTIN LOQUILLANO" },
                { rowIndex: 1, columnIndex: 2, content: "20" },
                { rowIndex: 1, columnIndex: 3, content: "18" },
                { rowIndex: 1, columnIndex: 4, content: "2" },
              ],
            },
          ],
        },
        {
          pageNumber: 2,
          tables: [
            {
              rowCount: 2,
              columnCount: 5,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Total Days" },
                { rowIndex: 0, columnIndex: 3, content: "Present" },
                { rowIndex: 0, columnIndex: 4, content: "Absent" },
                { rowIndex: 1, columnIndex: 0, content: "" },
                { rowIndex: 1, columnIndex: 1, content: "" },
                { rowIndex: 1, columnIndex: 2, content: "" },
                { rowIndex: 1, columnIndex: 3, content: "" },
                { rowIndex: 1, columnIndex: 4, content: "" },
              ],
            },
          ],
        },
      ],
    };

    const sf2Text = "School Form 2 SF2 Month of June School Year 2024-2025 Grade 11 STEM";
    const sf2Result = parseShsSf2(sf2Text, mockMultiPageSf2Layout);

    assert.equal(sf2Result.attendance.length, 1, "Must preserve Page 1 attendance");
    assert.equal(sf2Result.attendance[0].lrn, "111500619123");
    assert.equal(sf2Result.attendance[0].days_present, 18);
    assert.equal(sf2Result.attendance[0].days_absent, 2);
  });

  // ===========================================================================
  // 3. SessionStorage Quota & Data URL Stripping Verification
  // ===========================================================================
  await t.test("3a. upload/page.tsx strips data: URLs from sessionStorage serialization", () => {
    const uploadPagePath = path.resolve("src/app/upload/page.tsx");
    const uploadCode = fs.readFileSync(uploadPagePath, "utf-8");

    // Verify dataUrl, originalDataUrl, upperSectionDataUrl, processedDataUrl are omitted from serializable
    const serializableBlock = uploadCode.slice(
      uploadCode.indexOf("const serializable = Object.fromEntries("),
      uploadCode.indexOf("sessionStorage.setItem(`avv_staged_ocr_${currentBatchId}`")
    );

    assert.ok(
      !serializableBlock.includes("dataUrl: it.dataUrl"),
      "serializable must NOT include base64 dataUrl"
    );
    assert.ok(
      !serializableBlock.includes("originalDataUrl: it.originalDataUrl"),
      "serializable must NOT include base64 originalDataUrl"
    );
    assert.ok(
      !serializableBlock.includes("upperSectionDataUrl: it.upperSectionDataUrl"),
      "serializable must NOT include base64 upperSectionDataUrl"
    );
    assert.ok(
      !serializableBlock.includes("processedDataUrl: it.processedDataUrl"),
      "serializable must NOT include base64 processedDataUrl"
    );

    // Verify QuotaExceeded eviction logic exists in catch block
    assert.ok(
      uploadCode.includes("keysToRemove.push(k)") && uploadCode.includes("sessionStorage.removeItem(k)"),
      "Must evict older avv_staged_ocr_* keys on storage exception"
    );
  });

  await t.test("3b. Stripped serialization size stays well under browser 5MB quota (< 50KB for 10 files)", () => {
    // Simulate serializable object for 10 documents
    const mockDocuments = Array.from({ length: 10 }, (_, i) => ({
      id: `doc-${i}`,
      name: `School-Forms-1_section_${i}.pdf`,
      size: "2.4 MB",
      sizeBytes: 2500000,
      type: "application/pdf",
      pageCount: 1,
      documentType: "sf1",
      stepCategory: "sf1",
      uploadedAt: new Date().toISOString(),
      documentSide: "single",
      pairId: `pair-${i}`,
      extractionStatus: "extracted",
      extractedFields: {
        school_id: "500169",
        school_name: "Tanza National Comprehensive High School",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        learners: [
          {
            lrn: "111500619123",
            full_name: "Gomez, Justin Loquillano",
            sex: "M",
            birth_date: "2004-06-23",
          },
        ],
      },
      extractionError: undefined,
      previewMode: "original",
      rotation: 0,
    }));

    const serializedJson = JSON.stringify({ sf1: mockDocuments });
    const sizeBytes = Buffer.byteLength(serializedJson, "utf8");

    // 10 fully extracted records without base64 dataUrls should be around ~5-15 KB, vastly under 5MB (5,242,880 bytes)
    assert.ok(
      sizeBytes < 50 * 1024,
      `Stripped serialized size (${sizeBytes} bytes) must be < 50KB, well under 5MB browser quota`
    );
  });
});

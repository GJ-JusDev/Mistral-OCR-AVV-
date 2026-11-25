import test from "node:test";
import assert from "node:assert/strict";

import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

test("AVV SF5 Removal from OCR API Whitelist Regression Suite", async (t) => {
  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    process.env.OCR_PRIMARY_PROVIDER = "mistral";
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  const validBase64Image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const mockSf5OcrCaller = async () => ({
    text: "Republic of the Philippines\nDepartment of Education\nSchool Form 5 (SF5)\nGrade 11 Section: Diamond S.Y. 2024-2025\n1. 109345000001 DELA CRUZ, CARLOS M. Male Gen Avg: 88 Action: PROMOTED",
    model: "mistral-ocr-latest",
  });

  // 1. /api/ocr rejects sf5a
  await t.test("1. /api/ocr rejects 'sf5a' documentType with HTTP 400 DOCUMENT_TYPE_NOT_SUPPORTED", async () => {
    const req = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: validBase64Image,
        documentType: "sf5a",
        extractFields: true,
      }),
    });

    const res = await handleOcrRoute(req, "mock-key", parseGradesText, mockSf5OcrCaller);
    assert.strictEqual(res.status, 400, `Expected status 400 for sf5a, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.code, "DOCUMENT_TYPE_NOT_SUPPORTED");
  });

  // 2. /api/ocr rejects sf5b
  await t.test("2. /api/ocr rejects 'sf5b' documentType with HTTP 400 DOCUMENT_TYPE_NOT_SUPPORTED", async () => {
    const req = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: validBase64Image,
        documentType: "sf5b",
        extractFields: true,
      }),
    });

    const res = await handleOcrRoute(req, "mock-key", parseGradesText, mockSf5OcrCaller);
    assert.strictEqual(res.status, 400, `Expected status 400 for sf5b, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.code, "DOCUMENT_TYPE_NOT_SUPPORTED");
  });

  // 3. /api/ocr rejects canonical sf5
  await t.test("3. /api/ocr rejects canonical 'sf5' documentType with HTTP 400 DOCUMENT_TYPE_NOT_SUPPORTED", async () => {
    const req = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: validBase64Image,
        documentType: "sf5",
        extractFields: true,
      }),
    });

    const res = await handleOcrRoute(req, "mock-key", parseGradesText, mockSf5OcrCaller);
    assert.strictEqual(res.status, 400, `Expected status 400 for sf5, got ${res.status}`);
    const data = await res.json();
    assert.strictEqual(data.code, "DOCUMENT_TYPE_NOT_SUPPORTED");
  });

  // 4. Other unsupported types remain rejected with HTTP 400
  await t.test("4. Other unsupported types ('sf3', 'sf4', 'invalid_doc') return HTTP 400", async () => {
    const unsupportedList = ["sf3", "sf4", "sf6", "sf7", "sf8", "invalid_doc"];

    for (const badType of unsupportedList) {
      const req = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: validBase64Image,
          documentType: badType,
        }),
      });

      const res = await handleOcrRoute(req, "mock-key", parseGradesText, mockSf5OcrCaller);
      assert.strictEqual(res.status, 400, `Expected 400 for unsupported type '${badType}', got ${res.status}`);
      const data = await res.json();
      assert.strictEqual(data.code, "DOCUMENT_TYPE_NOT_SUPPORTED");
    }
  });

  // 5. Existing supported document types remain unaffected
  await t.test("5. Whitelisted active document types ('sf1', 'sf2', 'sf9', 'sf10', 'birth_cert', 'psa') remain accepted", async () => {
    const supportedList = ["sf1", "sf2", "sf9", "sf10", "birth_cert", "psa"];

    for (const validDoc of supportedList) {
      const req = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: validBase64Image,
          documentType: validDoc,
        }),
      });

      const res = await handleOcrRoute(req, "mock-key", undefined, mockSf5OcrCaller);
      assert.strictEqual(res.status, 200, `Expected 200 for supported type '${validDoc}', got ${res.status}`);
    }
  });
});

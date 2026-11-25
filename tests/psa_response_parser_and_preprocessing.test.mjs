import test from "node:test";
import assert from "node:assert/strict";

import { parseApiResponseSafely } from "../src/lib/ocr/apiResponseParser.ts";
import {
  enhancePsaPixelBuffer,
  preprocessPsaImage,
} from "../src/lib/ocr/psaPreprocessing.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { OcrProviderError } from "../src/lib/ocr/providers/types.ts";

/**
 * Helper to build a synthetic Response object for parseApiResponseSafely testing.
 */
function makeMockResponse({
  status = 200,
  ok = true,
  body = "",
  contentType = "application/json",
  headers = {},
  throwOnText = false,
} = {}) {
  const headerMap = new Map();
  if (contentType) {
    headerMap.set("content-type", contentType);
  }
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }

  return {
    status,
    ok,
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) || null,
    },
    text: async () => {
      if (throwOnText) {
        throw new Error("Socket prematurely disconnected");
      }
      return body;
    },
    json: async () => {
      if (throwOnText) {
        throw new Error("Socket prematurely disconnected");
      }
      return JSON.parse(body);
    },
  };
}

test("AVV PSA Response Parser and Safe B&W Preprocessing Suite", async (t) => {
  // =========================================================================
  // 1. SAFE API RESPONSE PARSER (Part 1 - Fixing Unexpected end of JSON input)
  // =========================================================================

  await t.test("1.1 handles empty response body without throwing JSON parse error", async () => {
    // Simulates an empty 200 OK or generic empty response
    const mockRes = makeMockResponse({ status: 200, ok: true, body: "" });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.code, "EMPTY_RESPONSE");
    assert.match(result.error, /empty response/i);
  });

  await t.test("1.2 maps empty HTTP 504 Gateway Timeout to helpful timeout error", async () => {
    const mockRes = makeMockResponse({ status: 504, ok: false, body: "   " });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 504);
    assert.strictEqual(result.code, "TIMEOUT");
    assert.match(result.error, /timed out/i);
  });

  await t.test("1.3 maps empty HTTP 502 Bad Gateway to temporary availability error", async () => {
    const mockRes = makeMockResponse({ status: 502, ok: false, body: "" });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 502);
    assert.strictEqual(result.code, "BAD_GATEWAY");
    assert.match(result.error, /temporarily unavailable/i);
  });

  await t.test("1.4 maps empty HTTP 413 to payload too large error", async () => {
    const mockRes = makeMockResponse({ status: 413, ok: false, body: "" });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 413);
    assert.strictEqual(result.code, "PAYLOAD_TOO_LARGE");
    assert.match(result.error, /exceeds the maximum upload limit/i);
  });

  await t.test("1.5 safely extracts text from HTML Gateway error pages (e.g. Nginx/Vercel 502)", async () => {
    const htmlBody = `<!DOCTYPE html>
<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>cloudflare / proxy</center>
</body>
</html>`;

    const mockRes = makeMockResponse({
      status: 502,
      ok: false,
      body: htmlBody,
      contentType: "text/html; charset=UTF-8",
    });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 502);
    assert.strictEqual(result.data, null);
    assert.strictEqual(result.code, "BAD_GATEWAY");
    assert.match(result.error, /Bad Gateway/i);
    assert.doesNotMatch(result.error, /<html>/i);
  });

  await t.test("1.6 safely parses plain text error responses", async () => {
    const plainText = "Internal Server Error: Downstream service terminated";
    const mockRes = makeMockResponse({
      status: 500,
      ok: false,
      body: plainText,
      contentType: "text/plain",
    });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 500);
    assert.match(result.error, /Internal Server Error: Downstream service terminated/);
    assert.strictEqual(result.code, "NON_JSON_RESPONSE");
  });

  await t.test("1.7 parses valid JSON success response cleanly", async () => {
    const successData = {
      documentType: "PSA",
      extractedData: {
        childName: "JUAN DELA CRUZ",
        registryNumber: "2005-12345",
      },
      preprocessed: true,
      provider: "azure",
    };
    const mockRes = makeMockResponse({
      status: 200,
      ok: true,
      body: JSON.stringify(successData),
      contentType: "application/json",
    });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.data, successData);
    assert.strictEqual(result.error, undefined);
  });

  await t.test("1.8 parses valid JSON error response with diagnostic codes", async () => {
    const errorBody = {
      error: "The input image dimensions are out of range: min [50, 50], max [10000, 10000]. Actual [12000, 8000].",
      code: "INVALID_DIMENSIONS",
      diagnosticCode: "InvalidContentDimensions",
    };
    const mockRes = makeMockResponse({
      status: 400,
      ok: false,
      body: JSON.stringify(errorBody),
      contentType: "application/json",
    });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, errorBody.error);
    assert.strictEqual(result.code, errorBody.code);
    assert.strictEqual(result.diagnosticCode, errorBody.diagnosticCode);
  });

  await t.test("1.9 handles network read errors when res.text() throws", async () => {
    const mockRes = makeMockResponse({ status: 500, ok: false, throwOnText: true });
    const result = await parseApiResponseSafely(mockRes);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "NETWORK_READ_ERROR");
    assert.match(result.error, /Socket prematurely disconnected/);
  });

  // =========================================================================
  // 2. BLACK-AND-WHITE PSA OCR PREPROCESSING (Part 2)
  // =========================================================================

  await t.test("2.1 enhancePsaPixelBuffer converts RGBA to enhanced grayscale and cleans background", () => {
    const width = 10;
    const height = 10;
    const buffer = new Uint8ClampedArray(width * height * 4);

    // Fill with light greenish/blue SECPA paper pattern (e.g. R=220, G=230, B=225)
    for (let i = 0; i < width * height; i++) {
      buffer[i * 4] = 220;
      buffer[i * 4 + 1] = 230;
      buffer[i * 4 + 2] = 225;
      buffer[i * 4 + 3] = 255;
    }

    // Place a dark character in the center (pixel 5,5 -> index 55)
    const centerIdx = 55;
    buffer[centerIdx * 4] = 20;
    buffer[centerIdx * 4 + 1] = 20;
    buffer[centerIdx * 4 + 2] = 20;
    buffer[centerIdx * 4 + 3] = 255;

    enhancePsaPixelBuffer(buffer, width, height, {
      windowRadius: 3,
      thresholdPercent: 0.10,
      contrastFactor: 1.2,
    });

    // Check that output is pure grayscale (R === G === B)
    for (let i = 0; i < width * height; i++) {
      const r = buffer[i * 4];
      const g = buffer[i * 4 + 1];
      const b = buffer[i * 4 + 2];
      const a = buffer[i * 4 + 3];
      assert.strictEqual(r, g, `Pixel ${i} R should equal G`);
      assert.strictEqual(g, b, `Pixel ${i} G should equal B`);
      assert.strictEqual(a, 255, `Pixel ${i} Alpha should be 255`);
    }

    // The dark character center must remain dark (<= 50)
    const darkVal = buffer[centerIdx * 4];
    assert.ok(
      darkVal <= 50,
      `Dark text character should stay dark, got ${darkVal}`
    );

    // The SECPA background pixels far from the character should be pushed to clean white (255)
    const cornerVal = buffer[0];
    assert.strictEqual(
      cornerVal,
      255,
      `SECPA background pixel should be clean white (255), got ${cornerVal}`
    );
  });

  await t.test("2.2 preserves thin printed characters, typewriter dots, and ballpen strokes without clipping", () => {
    const width = 16;
    const height = 16;
    const buffer = new Uint8ClampedArray(width * height * 4);

    // Fill background with textured off-white (210-220)
    for (let i = 0; i < width * height; i++) {
      const noise = (i % 3) * 5;
      buffer[i * 4] = 210 + noise;
      buffer[i * 4 + 1] = 210 + noise;
      buffer[i * 4 + 2] = 210 + noise;
      buffer[i * 4 + 3] = 255;
    }

    // Add a 1-pixel thin line across row 8 with faint typewriter ink (gray value ~110)
    for (let x = 0; x < width; x++) {
      const idx = 8 * width + x;
      buffer[idx * 4] = 110;
      buffer[idx * 4 + 1] = 110;
      buffer[idx * 4 + 2] = 110;
      buffer[idx * 4 + 3] = 255;
    }

    enhancePsaPixelBuffer(buffer, width, height, {
      windowRadius: 4,
      thresholdPercent: 0.10,
    });

    // Verify all pixels on the thin line are preserved and darker than the surrounding paper
    for (let x = 0; x < width; x++) {
      const lineVal = buffer[(8 * width + x) * 4];
      const aboveVal = buffer[(7 * width + x) * 4];
      assert.ok(
        lineVal < aboveVal,
        `Thin line at x=${x} (${lineVal}) must be darker than background (${aboveVal})`
      );
      assert.ok(
        lineVal < 150,
        `Thin line stroke should not be erased to white, got ${lineVal}`
      );
    }
  });

  await t.test("2.3 preprocessPsaImage preserves PDF documents directly without rasterization", async () => {
    const samplePdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQKJ...";
    const result = await preprocessPsaImage(samplePdfDataUrl);

    assert.strictEqual(result.wasProcessed, false);
    assert.strictEqual(result.format, "pdf");
    assert.strictEqual(result.originalDataUrl, samplePdfDataUrl);
    assert.strictEqual(result.processedDataUrl, samplePdfDataUrl);
    assert.match(result.skippedReason, /preserve original vector\/page stream/i);
  });

  await t.test("2.4 preprocessPsaImage handles empty and invalid inputs gracefully", async () => {
    const emptyResult = await preprocessPsaImage("");
    assert.strictEqual(emptyResult.wasProcessed, false);
    assert.strictEqual(emptyResult.format, "unknown");

    const nullResult = await preprocessPsaImage(null);
    assert.strictEqual(nullResult.wasProcessed, false);
  });

  await t.test("2.5 preprocessPsaImage safely falls back when running in headless Node.js without canvas", async () => {
    const sampleJpegDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg...";
    const result = await preprocessPsaImage(sampleJpegDataUrl);

    // In Node.js environment without window/document, it safely leaves original image intact
    assert.strictEqual(result.wasProcessed, false);
    assert.strictEqual(result.format, "jpeg");
    assert.strictEqual(result.originalDataUrl, sampleJpegDataUrl);
    assert.strictEqual(result.processedDataUrl, sampleJpegDataUrl);
    assert.match(result.skippedReason, /Browser Canvas is not available/i);
  });

  await t.test("2.6 preprocessPsaImage executes full browser canvas pipeline when DOM is present", async () => {
    // Mock minimal HTMLImageElement and HTMLCanvasElement
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    try {
      const mockCanvas = {
        width: 20,
        height: 20,
        toDataURL: (fmt, quality) => `data:${fmt};base64,ENHANCED_IMAGE_DATA`,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (x, y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            data.fill(200); // sample background
            return { data, width: w, height: h };
          },
          putImageData: () => {},
        }),
      };

      globalThis.window = {};
      globalThis.document = {
        createElement: (tag) => {
          if (tag === "canvas") return mockCanvas;
          return {};
        },
      };

      // Mock Image constructor
      globalThis.Image = class {
        set src(val) {
          setTimeout(() => {
            this.naturalWidth = 20;
            this.naturalHeight = 20;
            if (this.onload) this.onload();
          }, 5);
        }
      };

      const samplePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...";
      const result = await preprocessPsaImage(samplePng);

      assert.strictEqual(result.wasProcessed, true);
      assert.strictEqual(result.format, "png");
      assert.strictEqual(result.processedDataUrl, "data:image/png;base64,ENHANCED_IMAGE_DATA");
      assert.strictEqual(result.originalDataUrl, samplePng);
      assert.strictEqual(result.width, 20);
      assert.strictEqual(result.height, 20);
    } finally {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      delete globalThis.Image;
    }
  });

  // =========================================================================
  // 3. OCR ORCHESTRATOR PROVIDER INTEGRITY (Azure Primary / Mistral Fallback)
  // =========================================================================

  await t.test("3.1 orchestrator uses Azure as primary provider when configured and healthy", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    const mockAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        return {
          text: "CERTIFICATE OF LIVE BIRTH",
          provider: "azure",
          model: "prebuilt-layout",
          durationMs: 150,
          confidence: 0.98,
        };
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return {
          text: "MISTRAL OCR RESULT",
          provider: "mistral",
          model: "mistral-ocr-latest",
          durationMs: 200,
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,dummy-psa-content",
    });

    assert.strictEqual(result.provider, "azure");
    assert.strictEqual(azureCalled, 1);
    assert.strictEqual(mistralCalled, 0, "Mistral fallback must NOT be called when Azure succeeds");
  });

  await t.test("3.2 orchestrator safely falls back to Mistral when Azure encounters an error", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    const mockAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        throw new OcrProviderError("Azure service unavailable", {
          provider: "azure",
          status: 503,
          code: "SERVICE_UNAVAILABLE",
        });
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return {
          text: "CERTIFICATE OF LIVE BIRTH FALLBACK",
          provider: "mistral",
          model: "mistral-ocr-latest",
          durationMs: 210,
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,dummy-psa-content",
    });

    assert.strictEqual(result.provider, "mistral");
    assert.strictEqual(azureCalled, 1);
    assert.strictEqual(mistralCalled, 1, "Mistral fallback MUST be called when Azure fails");
    assert.strictEqual(result.text, "CERTIFICATE OF LIVE BIRTH FALLBACK");
  });
});

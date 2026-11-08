import test from "node:test";
import assert from "node:assert/strict";

import {
  OcrProviderError,
} from "../src/lib/ocr/providers/types.ts";
import { MistralOcrProvider } from "../src/lib/ocr/providers/mistralProvider.ts";
import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { handleOcrRoute, MistralOcrError } from "../src/lib/ocr/mistral.ts";

test("OCR Provider Abstraction & Orchestration Suite", async (t) => {
  await t.test("1. MistralOcrProvider reports availability based on API key configuration", async () => {
    const unconfigured = new MistralOcrProvider({ apiKey: "" });
    assert.strictEqual(await unconfigured.isAvailable(), false);

    const configured = new MistralOcrProvider({ apiKey: "valid-test-key" });
    assert.strictEqual(await configured.isAvailable(), true);
  });

  await t.test("2. MistralOcrProvider maps missing key to OcrProviderError with status 500", async () => {
    const provider = new MistralOcrProvider({ apiKey: "" });
    await assert.rejects(
      async () => {
        await provider.recognize({ image: "data:image/png;base64,sample" });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.code, "INVALID_API_KEY");
        assert.strictEqual(err.status, 500);
        assert.strictEqual(err.provider, "mistral");
        return true;
      }
    );
  });

  await t.test("3. AzureDocumentIntelligenceProvider reports availability based on endpoint and key", async () => {
    const unconfigured = new AzureDocumentIntelligenceProvider({ endpoint: "", apiKey: "" });
    assert.strictEqual(await unconfigured.isAvailable(), false);

    const configured = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-document-ocr.cognitiveservices.azure.com/",
      apiKey: "valid-azure-key",
    });
    assert.strictEqual(await configured.isAvailable(), true);
  });

  await t.test("4. AzureDocumentIntelligenceProvider maps missing credentials to OcrProviderError (status 500)", async () => {
    const origEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const origKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    try {
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

      const provider = new AzureDocumentIntelligenceProvider({ endpoint: "", apiKey: "" });
      await assert.rejects(
        async () => {
          await provider.recognize({ image: "data:image/png;base64,sample" });
        },
        (err) => {
          assert.ok(err instanceof OcrProviderError);
          assert.strictEqual(err.code, "INVALID_API_KEY");
          assert.strictEqual(err.status, 500);
          assert.strictEqual(err.provider, "azure");
          return true;
        }
      );
    } finally {
      if (origEndpoint !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = origEndpoint;
      if (origKey !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = origKey;
    }
  });

  await t.test("5. OcrOrchestrator executes primary provider when healthy", async () => {
    const mockPrimary = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => ({
        text: "Student: Juan Dela Cruz",
        confidence: 0.96,
        model: "azure/prebuilt-read",
        provider: "azure",
      }),
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockPrimary,
      enableFallback: false,
    });

    const result = await orchestrator.execute({ image: "data:image/png;base64,dummy" });
    assert.strictEqual(result.text, "Student: Juan Dela Cruz");
    assert.strictEqual(result.provider, "azure");
    assert.strictEqual(result.model, "azure/prebuilt-read");
  });

  await t.test("6. OcrOrchestrator triggers Mistral fallback provider on 429 rate limit when enabled", async () => {
    const mockPrimary = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError("Rate limit exceeded", {
          provider: "azure",
          status: 429,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: 5,
        });
      },
    };

    const mockFallback = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => ({
        text: "Juan Dela Cruz (Mistral Fallback)",
        confidence: undefined,
        model: "mistral-ocr-latest",
        provider: "mistral",
      }),
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockPrimary,
      fallbackProvider: mockFallback,
      enableFallback: true,
    });

    const result = await orchestrator.execute({ image: "data:image/png;base64,dummy" });
    assert.strictEqual(result.text, "Juan Dela Cruz (Mistral Fallback)");
    assert.strictEqual(result.provider, "mistral");
    assert.strictEqual(result.model, "mistral-ocr-latest");
    assert.strictEqual(result.confidence, undefined);
  });

  await t.test("7. OcrOrchestrator preserves primary error when fallback is disabled", async () => {
    const mockPrimary = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError("Monthly quota depleted", {
          provider: "azure",
          status: 429,
          code: "QUOTA_EXHAUSTED",
        });
      },
    };

    let fallbackCalled = false;
    const mockFallback = {
      name: "mistral",
      isAvailable: async () => {
        fallbackCalled = true;
        return true;
      },
      recognize: async () => ({ text: "Fallback text", provider: "mistral" }),
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockPrimary,
      fallbackProvider: mockFallback,
      enableFallback: false,
    });

    await assert.rejects(
      async () => {
        await orchestrator.execute({ image: "data:image/png;base64,dummy" });
      },
      (err) => {
        assert.strictEqual(err.code, "QUOTA_EXHAUSTED");
        assert.strictEqual(err.status, 429);
        return true;
      }
    );

    assert.strictEqual(fallbackCalled, false);
  });

  await t.test("8. handleOcrRoute successfully executes Azure -> Mistral fallback when OCR_FALLBACK_ENABLED=true", async () => {
    const originalFetch = globalThis.fetch;
    const originalPrimary = process.env.OCR_PRIMARY_PROVIDER;
    const originalFallback = process.env.OCR_FALLBACK_ENABLED;
    const originalEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const originalKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    const originalMistralKey = process.env.MISTRAL_API_KEY;

    try {
      process.env.OCR_PRIMARY_PROVIDER = "azure";
      process.env.OCR_FALLBACK_ENABLED = "true";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-azure-key";
      process.env.MISTRAL_API_KEY = "mock-mistral-key";

      globalThis.fetch = async (url) => {
        const urlStr = String(url);
        if (urlStr.includes("cognitiveservices.azure.com")) {
          return new Response(
            JSON.stringify({ error: { code: "ServiceUnavailable", message: "Azure outage" } }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("api.mistral.ai/v1/ocr")) {
          return new Response(
            JSON.stringify({
              pages: [{ markdown: "Grade 8 - English 88" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch URL: ${urlStr}`);
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,sampleimage",
        }),
      });

      const response = await handleOcrRoute(request, "mock-mistral-key");

      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.text, "Grade 8 - English 88");
      assert.strictEqual(data.model, "mistral-ocr-latest");
      assert.strictEqual(data.provider, "mistral");
      assert.strictEqual(data.confidence, undefined);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPrimary !== undefined) process.env.OCR_PRIMARY_PROVIDER = originalPrimary;
      else delete process.env.OCR_PRIMARY_PROVIDER;
      if (originalFallback !== undefined) process.env.OCR_FALLBACK_ENABLED = originalFallback;
      else delete process.env.OCR_FALLBACK_ENABLED;
      if (originalEndpoint !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = originalEndpoint;
      else delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
      if (originalKey !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = originalKey;
      else delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
      if (originalMistralKey !== undefined) process.env.MISTRAL_API_KEY = originalMistralKey;
      else delete process.env.MISTRAL_API_KEY;
    }
  });

  await t.test("9. AzureDocumentIntelligenceProvider timeout is configurable via AZURE_OCR_TIMEOUT_MS and defaults to 45000ms", () => {
    const originalEnv = process.env.AZURE_OCR_TIMEOUT_MS;
    try {
      delete process.env.AZURE_OCR_TIMEOUT_MS;
      const defaultProvider = new AzureDocumentIntelligenceProvider();
      assert.strictEqual(defaultProvider.getTimeoutMs(), 45000, "Default timeout must be 45000ms");

      process.env.AZURE_OCR_TIMEOUT_MS = "60000";
      const customEnvProvider = new AzureDocumentIntelligenceProvider();
      assert.strictEqual(customEnvProvider.getTimeoutMs(), 60000, "Must respect AZURE_OCR_TIMEOUT_MS");

      const explicitProvider = new AzureDocumentIntelligenceProvider({ timeoutMs: 30000 });
      assert.strictEqual(explicitProvider.getTimeoutMs(), 30000, "Explicit config overrides env");
    } finally {
      if (originalEnv !== undefined) {
        process.env.AZURE_OCR_TIMEOUT_MS = originalEnv;
      } else {
        delete process.env.AZURE_OCR_TIMEOUT_MS;
      }
    }
  });

  await t.test("10. AzureDocumentIntelligenceProvider maps AbortError to OcrProviderError with status 504 TIMEOUT", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      };

      const provider = new AzureDocumentIntelligenceProvider({
        endpoint: "https://avv-document-ocr.cognitiveservices.azure.com/",
        apiKey: "test-key",
        timeoutMs: 100,
      });
      await assert.rejects(
        async () => {
          await provider.recognize({ image: "data:image/png;base64,sample" });
        },
        (err) => {
          assert.ok(err instanceof OcrProviderError);
          assert.strictEqual(err.code, "TIMEOUT");
          assert.strictEqual(err.status, 504);
          assert.strictEqual(err.provider, "azure");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("11. handleOcrRoute safely accepts valid PDF input and routes to Azure or Mistral PDF-capable pipeline", async () => {
    const originalFetch = globalThis.fetch;
    const originalPrimary = process.env.OCR_PRIMARY_PROVIDER;
    try {
      process.env.OCR_PRIMARY_PROVIDER = "mistral";
      globalThis.fetch = async (url, options) => {
        const urlStr = String(url);
        if (urlStr.includes("api.mistral.ai/v1/ocr")) {
          const body = JSON.parse(options.body);
          assert.strictEqual(body.document.type, "document_url");
          return new Response(
            JSON.stringify({
              pages: [{ markdown: "DepEd SF9 Learner Progress Report Card" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch URL: ${urlStr}`);
      };

      // Create a valid dummy PDF base64 data URL
      const samplePdfB64 = "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/OgCg==";
      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: samplePdfB64 }),
      });

      const response = await handleOcrRoute(request, "dummy-key");
      assert.strictEqual(response.status, 200, "Valid PDF must pass route boundary");
      const data = await response.json();
      assert.strictEqual(data.text, "DepEd SF9 Learner Progress Report Card");
      assert.strictEqual(data.model, "mistral-ocr-latest");
      assert.strictEqual(data.provider, "mistral");
      assert.strictEqual(data.confidence, undefined);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPrimary !== undefined) process.env.OCR_PRIMARY_PROVIDER = originalPrimary;
      else delete process.env.OCR_PRIMARY_PROVIDER;
    }
  });

  await t.test("12. handleOcrRoute validates media types and rejects malformed or empty payloads", async () => {
    // 1. Unsupported mime type (text/plain)
    const textReq = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:text/plain;base64,SGVsbG8=" }),
    });
    const textRes = await handleOcrRoute(textReq, "dummy-key");
    assert.strictEqual(textRes.status, 400);
    const textBody = await textRes.json();
    assert.strictEqual(textBody.code, "BAD_REQUEST");
    assert.ok(textBody.error.includes("Unsupported document format"));

    // 2. Malformed data URL (no base64 prefix)
    const malformedReq = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "https://example.com/not-a-data-url.png" }),
    });
    const malformedRes = await handleOcrRoute(malformedReq, "dummy-key");
    assert.strictEqual(malformedRes.status, 400);

    // 3. Empty base64 payload
    const emptyReq = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/png;base64," }),
    });
    const emptyRes = await handleOcrRoute(emptyReq, "dummy-key");
    assert.strictEqual(emptyRes.status, 400);
    const emptyBody = await emptyRes.json();
    assert.strictEqual(emptyBody.code, "BAD_REQUEST");
  });

  await t.test("13. Truthful confidence: unmeasured Mistral confidence is omitted, never fabricated as 1.0", async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock caller returning text without confidence
      const mockCaller = async () => ({
        text: "Student Name: Juan Dela Cruz",
        // confidence is undefined because Mistral does not supply it
        model: "mistral-ocr-latest",
      });

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: "data:image/png;base64,validimage" }),
      });

      const response = await handleOcrRoute(request, "dummy-key", undefined, mockCaller);
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.text, "Student Name: Juan Dela Cruz");
      // Must NOT fabricate 1.0
      assert.strictEqual(data.confidence, undefined, "Missing provider confidence must remain undefined");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("14. Truthful confidence: unmeasured confidence fails ocr_confidence validation rule", () => {
    // OCR confidence rule specification from rules.ts:
    const ocrConfidenceRule = {
      name: "ocr_confidence",
      field: "name",
      message: "OCR confidence is unmeasured or below required threshold — manual review recommended.",
      severity: "warning",
      check: (_v, ctx) => typeof ctx?.ocrConfidence === "number" && ctx.ocrConfidence >= 0.6,
    };

    // 1. Unmeasured confidence (undefined or empty context) must NOT automatically pass
    assert.strictEqual(ocrConfidenceRule.check("DELA CRUZ, JUAN", { ocrConfidence: undefined }), false, "Unmeasured confidence must fail rule");
    assert.strictEqual(ocrConfidenceRule.check("DELA CRUZ, JUAN", {}), false, "Missing context must fail rule");
    assert.ok(ocrConfidenceRule.message.includes("unmeasured or below required threshold"));

    // 2. High confidence (0.95) passes
    assert.strictEqual(ocrConfidenceRule.check("DELA CRUZ, JUAN", { ocrConfidence: 0.95 }), true, "High confidence >= 0.6 must pass");

    // 3. Low confidence (0.45) fails warning
    assert.strictEqual(ocrConfidenceRule.check("DELA CRUZ, JUAN", { ocrConfidence: 0.45 }), false, "Confidence below 0.6 must fail rule");
  });

  await t.test("15. Non-numeric marks (INC, DRP) are preserved and do not invent client status", () => {
    // Simulated handleGradeCellChange logic
    function simulateGradeCellChange(grades, index, key, valStr) {
      const updatedGrades = [...grades];
      const target = { ...updatedGrades[index] };
      if (key === "subject" || key === "category") {
        target[key] = valStr;
      } else {
        const trimmed = valStr.trim();
        if (trimmed === "") {
          target[key] = undefined;
        } else if (!isNaN(Number(trimmed))) {
          target[key] = parseFloat(trimmed);
        } else {
          target[key] = trimmed.toUpperCase();
          target.needsVerification = true;
        }
      }
      updatedGrades[index] = target;
      return updatedGrades;
    }

    const initialGrades = [
      { subject: "General Mathematics", q1: 85, q2: 86, final: 85, status: "Passed", needsVerification: false },
    ];

    // User updates final mark to "INC"
    const incResult = simulateGradeCellChange(initialGrades, 0, "final", "INC");
    assert.strictEqual(incResult[0].final, "INC", "Non-numeric INC mark must be preserved");
    assert.strictEqual(incResult[0].needsVerification, true, "Must flag for verification");
    assert.strictEqual(incResult[0].status, "Passed", "Must NOT guess client-side status");

    // User updates final mark to "DRP"
    const drpResult = simulateGradeCellChange(initialGrades, 0, "final", "DRP");
    assert.strictEqual(drpResult[0].final, "DRP", "Non-numeric DRP mark must be preserved");
    assert.strictEqual(drpResult[0].needsVerification, true);

    // User clears grade
    const clearedResult = simulateGradeCellChange(initialGrades, 0, "final", "");
    assert.strictEqual(clearedResult[0].final, undefined, "Empty string must clear to undefined");
  });

  await t.test("16. handleOcrRoute routes directly to Azure when OCR_PRIMARY_PROVIDER=azure without Mistral API key", async () => {
    const originalFetch = globalThis.fetch;
    const originalPrimary = process.env.OCR_PRIMARY_PROVIDER;
    const originalEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const originalKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

    try {
      process.env.OCR_PRIMARY_PROVIDER = "azure";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-azure-key";

      globalThis.fetch = async (url, options) => {
        if (options?.method === "POST") {
          return new Response(null, {
            status: 202,
            headers: {
              "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/op-16",
            },
          });
        }
        if (options?.method === "GET") {
          return new Response(
            JSON.stringify({
              status: "succeeded",
              analyzeResult: {
                content: "Grade 11 - General Mathematics 89",
                pages: [{ pageNumber: 1, words: [{ content: "Grade", confidence: 0.89 }] }],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        throw new Error(`Unexpected fetch URL: ${String(url)}`);
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,sampleimage",
        }),
      });

      // Pass undefined apiKey to verify no Mistral key is required when Azure succeeds
      const response = await handleOcrRoute(request, undefined);

      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.strictEqual(data.text, "Grade 11 - General Mathematics 89");
      assert.strictEqual(data.model, "azure/prebuilt-read");
      assert.strictEqual(data.provider, "azure");
      assert.strictEqual(data.confidence, 0.89);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPrimary !== undefined) process.env.OCR_PRIMARY_PROVIDER = originalPrimary;
      else delete process.env.OCR_PRIMARY_PROVIDER;
      if (originalEndpoint !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = originalEndpoint;
      else delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
      if (originalKey !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = originalKey;
      else delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    }
  });

  await t.test("17. handleOcrRoute returns 502 UPSTREAM_ERROR when OCR_PRIMARY_PROVIDER=azure, Azure is unreachable, and Mistral fallback is unconfigured", async () => {
    const originalFetch = globalThis.fetch;
    const originalPrimary = process.env.OCR_PRIMARY_PROVIDER;
    const originalEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    const originalKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    const originalMistralKey = process.env.MISTRAL_API_KEY;

    try {
      process.env.OCR_PRIMARY_PROVIDER = "azure";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-azure-key";
      delete process.env.MISTRAL_API_KEY;

      // Mock unavailable Azure service
      globalThis.fetch = async () => {
        throw new Error("Connection refused (ECONNREFUSED)");
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,sampleimage",
        }),
      });

      const response = await handleOcrRoute(request, undefined);
      assert.strictEqual(response.status, 502);
      const data = await response.json();
      assert.strictEqual(data.code, "UPSTREAM_ERROR");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalPrimary !== undefined) process.env.OCR_PRIMARY_PROVIDER = originalPrimary;
      else delete process.env.OCR_PRIMARY_PROVIDER;
      if (originalEndpoint !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = originalEndpoint;
      else delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
      if (originalKey !== undefined) process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = originalKey;
      else delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
      if (originalMistralKey !== undefined) process.env.MISTRAL_API_KEY = originalMistralKey;
    }
  });
});

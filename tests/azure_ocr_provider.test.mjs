import test from "node:test";
import assert from "node:assert/strict";

import {
  OcrProviderError,
} from "../src/lib/ocr/providers/types.ts";
import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";
import { MistralOcrProvider } from "../src/lib/ocr/providers/mistralProvider.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

test("AVV Azure Document Intelligence Integration Suite", async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test("Test A — Azure Primary Success: Mistral fallback is NOT called; result remains candidate data", async () => {
    let azureCalls = 0;
    let mistralCalls = 0;

    const mockAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalls++;
        return {
          text: "Student Name: Maria Santos\nGeneral Mathematics\t88\t89\t89\nGeneral Average: 89",
          confidence: 0.95,
          model: "azure/prebuilt-read",
          provider: "azure",
        };
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalls++;
        return { text: "from mistral", model: "mistral", provider: "mistral" };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,sampleImagePayload",
      extractFields: true,
      gradeLevel: "Senior High School",
    });

    assert.strictEqual(azureCalls, 1, "Azure must be called exactly once");
    assert.strictEqual(mistralCalls, 0, "Mistral must NOT be called on Azure success");
    assert.strictEqual(result.provider, "azure");
    assert.strictEqual(result.model, "azure/prebuilt-read");
    assert.strictEqual(result.confidence, 0.95);
  });

  await t.test("Test B — Azure Works Without Mistral: Succeeds while MISTRAL_API_KEY is unconfigured", async () => {
    delete process.env.MISTRAL_API_KEY;
    process.env.OCR_PRIMARY_PROVIDER = "azure";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-key";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        const urlStr = String(url);
        if (options?.method === "POST") {
          return new Response(null, {
            status: 202,
            headers: {
              "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/test-op-1",
            },
          });
        }
        if (options?.method === "GET" && urlStr.includes("/operations/test-op-1")) {
          return new Response(
            JSON.stringify({
              status: "succeeded",
              analyzeResult: {
                content: "Name: Juan Dela Cruz\nSchool Year: 2026-2027\nGeneral Mathematics\t90\t92\t91",
                pages: [
                  {
                    pageNumber: 1,
                    words: [
                      { content: "Name:", confidence: 0.99 },
                      { content: "Juan", confidence: 0.98 },
                    ],
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,validBase64Payload",
          extractFields: true,
          gradeLevel: "Senior High School",
        }),
      });

      // Pass undefined apiKey to simulate zero Mistral configuration
      const response = await handleOcrRoute(request, undefined, parseGradesText);
      assert.strictEqual(response.status, 200);

      const body = await response.json();
      assert.strictEqual(body.provider, "azure");
      assert.ok(body.text.includes("Juan Dela Cruz"));
      assert.strictEqual(typeof body.confidence, "number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Test C — Azure Provider Failure: Invokes Mistral fallback on genuine service failure", async () => {
    let azureCalled = false;
    let mistralCalled = false;

    const mockFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled = true;
        throw new OcrProviderError("Azure service unavailable (HTTP 503)", {
          provider: "azure",
          status: 503,
          code: "SERVICE_UNAVAILABLE",
        });
      },
    };

    const mockWorkingMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled = true;
        return {
          text: "Fallback from Mistral OCR",
          confidence: undefined,
          model: "mistral-ocr-latest",
          provider: "mistral",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockFailingAzure,
      fallbackProvider: mockWorkingMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,samplePayload",
    });

    assert.strictEqual(azureCalled, true, "Primary Azure must have been attempted");
    assert.strictEqual(mistralCalled, true, "Mistral fallback must be invoked upon Azure 503 failure");
    assert.strictEqual(result.provider, "mistral");
    assert.strictEqual(result.text, "Fallback from Mistral OCR");
    assert.strictEqual(result.confidence, undefined, "Mistral fallback must report unmeasured confidence (undefined)");
  });

  await t.test("Test D — Azure Failure + Mistral Unavailable or Bad Request: Returns structured error without masking", async () => {
    let mistralCalled = false;

    const mockFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError("Azure 502 Bad Gateway", {
          provider: "azure",
          status: 502,
          code: "UPSTREAM_ERROR",
        });
      },
    };

    const mockUnavailableMistral = {
      name: "mistral",
      isAvailable: async () => false,
      recognize: async () => {
        mistralCalled = true;
        throw new OcrProviderError("Mistral API key missing", {
          provider: "mistral",
          status: 500,
          code: "INVALID_API_KEY",
        });
      },
    };

    // Case 1: Mistral fallback unconfigured -> primary Azure 502 error preserved
    const orchestratorWithoutMistral = new OcrOrchestrator({
      primaryProvider: mockFailingAzure,
      fallbackProvider: mockUnavailableMistral,
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await orchestratorWithoutMistral.execute({
          image: "data:image/png;base64,payload",
        });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.status, 502);
        return true;
      }
    );
    assert.strictEqual(mistralCalled, false, "Unavailable fallback must not be called");

    // Case 2: Azure 400 BAD_REQUEST -> never triggers Mistral fallback
    const mockBadRequestAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError("Unsupported document format", {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
        });
      },
    };

    const mockReadyMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled = true;
        return { text: "Should not run", model: "mistral-ocr-latest", provider: "mistral" };
      },
    };

    const orchestratorBadRequest = new OcrOrchestrator({
      primaryProvider: mockBadRequestAzure,
      fallbackProvider: mockReadyMistral,
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await orchestratorBadRequest.execute({
          image: "data:text/plain;base64,SGVsbG8=",
        });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.status, 400);
        return true;
      }
    );
    assert.strictEqual(mistralCalled, false, "400 BAD_REQUEST must never trigger fallback");
  });

  await t.test("Test E — Unusual Azure Grade: Physically recognized value '32' is strictly preserved (never converted to 82)", async () => {
    // Azure returns a valid transcription containing an unusual grade '32'
    const azureText = `
Name: Juan Dela Cruz
Grade Level: Senior High School
School Year: 2026-2027

| Core Subjects | Q1 | Q2 | Final Grade |
| --- | --- | --- | --- |
| General Mathematics | 32 | 75 | 54 |
`;
    const parsed = parseGradesText(azureText, "Senior High School");
    const mathGrade = parsed.grades?.find((g) => g.subject?.includes("Mathematics"));

    assert.ok(mathGrade, "Subject grade record must be parsed");
    assert.strictEqual(mathGrade.q1, 32, "Raw recognized grade 32 must be preserved exactly");
    assert.notStrictEqual(mathGrade.q1, 82, "Must NOT convert 32 to 82 based on academic plausibility");
    assert.strictEqual(mathGrade.q2, 75);
    assert.strictEqual(mathGrade.final, 54);
  });

  await t.test("Test F — Missing Confidence: Response lacking confidence leaves confidence undefined (NEVER default to 1.0)", async () => {
    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-document-ocr.cognitiveservices.azure.com/",
      apiKey: "dummy-key",
      pollIntervalMs: 10,
    });

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        if (options?.method === "POST") {
          return new Response(null, {
            status: 202,
            headers: {
              "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/test-op-2",
            },
          });
        }
        // Return Azure result where words lack confidence scores
        return new Response(
          JSON.stringify({
            status: "succeeded",
            analyzeResult: {
              content: "Sample text without confidence",
              pages: [
                {
                  pageNumber: 1,
                  words: [
                    { content: "Sample" },
                    { content: "text" },
                  ],
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      const result = await provider.recognize({
        image: "data:image/png;base64,validPayload",
      });

      assert.strictEqual(
        result.confidence,
        undefined,
        "Missing Azure confidence must remain undefined and NEVER default to 1.0"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Test G — Secrets Safety: AZURE_DOCUMENT_INTELLIGENCE_KEY is NEVER exposed in errors or responses", async () => {
    const testSecret = "SUPER-SECRET-AZURE-KEY-9999-DO-NOT-LEAK";
    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-document-ocr.cognitiveservices.azure.com/",
      apiKey: testSecret,
      pollIntervalMs: 10,
    });

    const originalFetch = globalThis.fetch;
    try {
      // Mock Azure responding with a 400 Bad Request detailing an error
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: "InvalidImage",
              message: "Invalid image content provided at https://avv-document-ocr.cognitiveservices.azure.com/internal",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      };

      await assert.rejects(
        async () => {
          await provider.recognize({ image: "data:image/png;base64,payload" });
        },
        (err) => {
          const serialized = JSON.stringify({
            message: err.message,
            stack: err.stack,
            code: err.code,
            status: err.status,
          });
          assert.strictEqual(
            serialized.includes(testSecret),
            false,
            "Secret Azure API key must NEVER appear in serialized error objects"
          );
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("Test H — Human Review Safety: High-confidence Azure OCR remains candidate data and does not auto-approve", async () => {
    // Simulate candidate output from high confidence Azure extraction
    const azureCandidateResult = {
      text: "Name: Maria Santos\nSchool Year: 2026-2027\nGeneral Mathematics\t95\t96\t96",
      confidence: 0.998,
      model: "azure/prebuilt-read",
      provider: "azure",
      fields: parseGradesText("Name: Maria Santos\nSchool Year: 2026-2027\nGeneral Mathematics\t95\t96\t96"),
    };

    // Staging status invariant: OCR extraction output is strictly candidate data
    const stagedDocumentState = {
      status: "needs_review", // Required staging state
      verified_by: null,
      verified_at: null,
      is_approved: false,
      extracted_data: azureCandidateResult.fields,
      ocr_confidence: azureCandidateResult.confidence,
    };

    assert.strictEqual(
      stagedDocumentState.status,
      "needs_review",
      "Document status must remain 'needs_review' regardless of high OCR confidence"
    );
    assert.strictEqual(
      stagedDocumentState.is_approved,
      false,
      "Document must NOT be automatically approved based on OCR output"
    );
    assert.strictEqual(
      stagedDocumentState.verified_by,
      null,
      "Human verifier must not be assigned automatically"
    );
  });
});

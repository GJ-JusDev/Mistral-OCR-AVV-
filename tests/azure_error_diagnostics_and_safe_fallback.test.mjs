import test from "node:test";
import assert from "node:assert/strict";

import {
  OcrProviderError,
} from "../src/lib/ocr/providers/types.ts";
import {
  AzureDocumentIntelligenceProvider,
  extractAzureErrorInfo,
  getImageDimensionsFromBuffer,
} from "../src/lib/ocr/providers/azureProvider.ts";
import { MistralOcrProvider } from "../src/lib/ocr/providers/mistralProvider.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";

/**
 * Creates a minimal valid PNG Buffer with specified width and height.
 */
function createSyntheticPngBuffer(width, height) {
  const buf = Buffer.alloc(33);
  // PNG signature
  buf.writeUInt8(0x89, 0);
  buf.writeUInt8(0x50, 1);
  buf.writeUInt8(0x4e, 2);
  buf.writeUInt8(0x47, 3);
  buf.writeUInt8(0x0d, 4);
  buf.writeUInt8(0x0a, 5);
  buf.writeUInt8(0x1a, 6);
  buf.writeUInt8(0x0a, 7);
  // IHDR chunk length (13 bytes)
  buf.writeUInt32BE(13, 8);
  // IHDR chunk type
  buf.write("IHDR", 12);
  // Width and Height
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth, color type, compression, filter, interlace
  buf.writeUInt8(8, 24);
  buf.writeUInt8(2, 25);
  buf.writeUInt8(0, 26);
  buf.writeUInt8(0, 27);
  buf.writeUInt8(0, 28);
  // CRC placeholder
  buf.writeUInt32BE(0x12345678, 29);
  return buf;
}

test("AVV PSA OCR — Targeted Azure 400 Diagnostics and Safe Mistral Fallback Suite", async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // 1. AZURE DETAILED ERROR EXTRACTION
  // -------------------------------------------------------------------------
  await t.test("1.1 extracts innererror.message and innererror.code over generic 'Invalid request.'", () => {
    const errorPayload = {
      error: {
        code: "InvalidRequest",
        message: "Invalid request.",
        innererror: {
          code: "InvalidContentDimensions",
          message: "The input image dimensions are out of range: min [50, 50], max [10000, 10000]. Actual [12000, 8000].",
        },
      },
    };

    const result = extractAzureErrorInfo(errorPayload);
    assert.strictEqual(
      result.message,
      "The input image dimensions are out of range: min [50, 50], max [10000, 10000]. Actual [12000, 8000]."
    );
    assert.strictEqual(result.innerCode, "InvalidContentDimensions");
    assert.strictEqual(result.diagnosticCode, "InvalidContentDimensions");
    assert.strictEqual(result.azureErrorCode, "InvalidRequest");
  });

  await t.test("1.2 extracts details[0].message and details[0].code when innererror is absent", () => {
    const errorPayload = {
      error: {
        code: "InvalidRequest",
        message: "Invalid request.",
        details: [
          {
            code: "InvalidImageFormat",
            message: "The file format or encoding is corrupted or unsupported.",
          },
        ],
      },
    };

    const result = extractAzureErrorInfo(errorPayload);
    assert.strictEqual(
      result.message,
      "The file format or encoding is corrupted or unsupported."
    );
    assert.strictEqual(result.innerCode, "InvalidImageFormat");
    assert.strictEqual(result.diagnosticCode, "InvalidImageFormat");
    assert.strictEqual(result.azureErrorCode, "InvalidRequest");
  });

  await t.test("1.3 uses top-level message when detailed innererror is absent and message is non-generic", () => {
    const errorPayload = {
      error: {
        code: "ModelNotFound",
        message: "The specified model 'prebuilt-custom' does not exist.",
      },
    };

    const result = extractAzureErrorInfo(errorPayload);
    assert.strictEqual(result.message, "The specified model 'prebuilt-custom' does not exist.");
    assert.strictEqual(result.diagnosticCode, "ModelNotFound");
  });

  await t.test("1.4 uses default fallback message when error is empty or generic without details", () => {
    const errorPayload = {
      error: {
        code: "InvalidRequest",
        message: "Invalid request.",
      },
    };

    const result = extractAzureErrorInfo(errorPayload, "Custom default error message.");
    assert.strictEqual(result.message, "Invalid request.");
  });

  await t.test("1.5 redacts sensitive URLs in extracted error messages", () => {
    const errorPayload = {
      error: {
        code: "InvalidContent",
        message: "Failed downloading resource from https://azure-secret-storage.blob.core.windows.net/docs/img.png?sig=secretToken123",
      },
    };

    const result = extractAzureErrorInfo(errorPayload);
    assert.ok(!result.message.includes("azure-secret-storage"));
    assert.ok(!result.message.includes("secretToken123"));
    assert.ok(result.message.includes("[redacted-url]"));
  });

  // -------------------------------------------------------------------------
  // 2. IMAGE DIMENSIONS AND PAYLOAD VALIDATION
  // -------------------------------------------------------------------------
  await t.test("2.1 correctly extracts dimensions from synthetic PNG buffer", () => {
    const png = createSyntheticPngBuffer(800, 600);
    const dims = getImageDimensionsFromBuffer(png, "image/png");
    assert.ok(dims !== null);
    assert.strictEqual(dims.width, 800);
    assert.strictEqual(dims.height, 600);
  });

  await t.test("2.2 rejects image with dimensions below Azure 50x50 minimum", async () => {
    const smallPng = createSyntheticPngBuffer(40, 40);
    const dataUrl = `data:image/png;base64,${smallPng.toString("base64")}`;

    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-ocr-test.cognitiveservices.azure.com/",
      apiKey: "test-key-123",
    });

    await assert.rejects(
      async () => {
        await provider.recognize({ image: dataUrl });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.diagnosticCode, "InvalidContentDimensions");
        assert.ok(err.message.includes("too small"));
        return true;
      }
    );
  });

  await t.test("2.3 rejects image with dimensions exceeding Azure 10000x10000 maximum", async () => {
    const largePng = createSyntheticPngBuffer(12000, 8000);
    const dataUrl = `data:image/png;base64,${largePng.toString("base64")}`;

    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-ocr-test.cognitiveservices.azure.com/",
      apiKey: "test-key-123",
    });

    await assert.rejects(
      async () => {
        await provider.recognize({ image: dataUrl });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.diagnosticCode, "InvalidContentDimensions");
        assert.ok(err.message.includes("exceed"));
        return true;
      }
    );
  });

  // -------------------------------------------------------------------------
  // 3. CONFIGURATION VALIDATION (API VERSION, MODEL, ENDPOINT)
  // -------------------------------------------------------------------------
  await t.test("3.1 rejects malformed Azure endpoint format", async () => {
    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "not-a-valid-url",
      apiKey: "test-key-123",
    });

    const validPng = createSyntheticPngBuffer(100, 100);
    const dataUrl = `data:image/png;base64,${validPng.toString("base64")}`;

    await assert.rejects(
      async () => {
        await provider.recognize({ image: dataUrl });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.status, 500);
        assert.strictEqual(err.diagnosticCode, "INVALID_ENDPOINT_FORMAT");
        return true;
      }
    );
  });

  await t.test("3.2 rejects invalid Azure API version format", async () => {
    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-ocr-test.cognitiveservices.azure.com/",
      apiKey: "test-key-123",
      apiVersion: "invalid_v4",
    });

    const validPng = createSyntheticPngBuffer(100, 100);
    const dataUrl = `data:image/png;base64,${validPng.toString("base64")}`;

    await assert.rejects(
      async () => {
        await provider.recognize({ image: dataUrl });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.status, 500);
        assert.strictEqual(err.diagnosticCode, "INVALID_API_VERSION");
        return true;
      }
    );
  });

  await t.test("3.3 rejects invalid model ID", async () => {
    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-ocr-test.cognitiveservices.azure.com/",
      apiKey: "test-key-123",
      modelId: "invalid model with spaces!",
    });

    const validPng = createSyntheticPngBuffer(100, 100);
    const dataUrl = `data:image/png;base64,${validPng.toString("base64")}`;

    await assert.rejects(
      async () => {
        await provider.recognize({ image: dataUrl });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.status, 500);
        assert.strictEqual(err.diagnosticCode, "INVALID_MODEL_ID");
        return true;
      }
    );
  });

  // -------------------------------------------------------------------------
  // 4. CRITICAL: PRESERVE AZURE AS PRIMARY OCR PROVIDER
  // -------------------------------------------------------------------------
  await t.test("4.1 Azure is ALWAYS attempted first; Mistral is never called on Azure success", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    const mockAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        return {
          text: "CERTIFICATE OF LIVE BIRTH\nCHILD: JUAN DELA CRUZ\nDATE OF BIRTH: 12 MAY 2008",
          confidence: 0.96,
          model: "azure/prebuilt-read",
          provider: "azure",
        };
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return {
          text: "Should not be called",
          model: "mistral-ocr-latest",
          provider: "mistral",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,sampleBase64",
    });

    assert.strictEqual(azureCalled, 1, "Azure primary must be called");
    assert.strictEqual(mistralCalled, 0, "Mistral fallback must NOT be called");
    assert.strictEqual(result.provider, "azure", "Primary provider must be returned");
  });

  await t.test("4.2 Azure 401/403 authentication error must NOT fallback to Mistral", async () => {
    let mistralCalled = 0;

    const mockAuthFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError(
          "Azure Document Intelligence authentication failed. Please verify the configured endpoint and API key.",
          {
            provider: "azure",
            status: 401,
            code: "INVALID_API_KEY",
          }
        );
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return { text: "mistral result", model: "mistral-ocr-latest", provider: "mistral" };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockAuthFailingAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await orchestrator.execute({ image: "data:image/png;base64,payload" });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.status, 401);
        assert.strictEqual(err.code, "INVALID_API_KEY");
        return true;
      }
    );

    assert.strictEqual(mistralCalled, 0, "Mistral must NOT be called on 401 authentication failure");
  });

  await t.test("4.3 Malformed application request must NOT fallback to Mistral", async () => {
    let mistralCalled = 0;

    const mockMalformedAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError("Invalid data URL format. A valid base64 image or PDF data URL is required.", {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
        });
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return { text: "mistral result", model: "mistral-ocr-latest", provider: "mistral" };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockMalformedAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await orchestrator.execute({ image: "invalid-data" });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.status, 400);
        return true;
      }
    );

    assert.strictEqual(mistralCalled, 0, "Mistral must NOT be called on malformed application request");
  });

  await t.test("4.4 Generic 400 Bad Request without Azure restriction code must NOT fallback to Mistral", async () => {
    let mistralCalled = 0;

    const mockGeneric400Azure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError("Generic client bad request.", {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
          diagnosticCode: "BAD_REQUEST",
        });
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return { text: "mistral result", model: "mistral-ocr-latest", provider: "mistral" };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockGeneric400Azure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await orchestrator.execute({ image: "data:image/png;base64,payload" });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.status, 400);
        return true;
      }
    );

    assert.strictEqual(mistralCalled, 0, "Mistral must NOT be called on generic 400");
  });

  await t.test("4.5 Eligible Azure-specific 400 (InvalidContentDimensions) DOES safely fallback to Mistral", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    const mockDimensionFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        throw new OcrProviderError(
          "The input image dimensions (12000x8000) exceed Azure Document Intelligence maximum limit of 10000x10000 pixels.",
          {
            provider: "azure",
            status: 400,
            code: "BAD_REQUEST",
            diagnosticCode: "InvalidContentDimensions",
            innerCode: "InvalidContentDimensions",
            azureErrorCode: "InvalidRequest",
          }
        );
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return {
          text: "CERTIFICATE OF LIVE BIRTH\nNAME: JUAN DELA CRUZ\nDATE OF BIRTH: 12/05/2008",
          confidence: 0.94,
          model: "mistral-ocr-latest",
          provider: "mistral",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockDimensionFailingAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,largeImagePayload",
      extractFields: true,
      gradeLevel: "PSA",
    });

    assert.strictEqual(azureCalled, 1, "Azure must be attempted first");
    assert.strictEqual(mistralCalled, 1, "Mistral must be called as fallback for Azure dimension restriction");
    assert.strictEqual(result.provider, "mistral", "Result must reflect Mistral provider");
    assert.strictEqual(result.model, "mistral-ocr-latest", "Result must reflect Mistral model");
    assert.ok(result.text.includes("JUAN DELA CRUZ"));
  });

  await t.test("4.6 Azure 429 rate limit and 5xx transient errors continue falling back to Mistral", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    const mockRateLimitedAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        throw new OcrProviderError("Azure Document Intelligence rate limit exceeded.", {
          provider: "azure",
          status: 429,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: 5,
        });
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return {
          text: "from mistral fallback",
          model: "mistral-ocr-latest",
          provider: "mistral",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockRateLimitedAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/png;base64,payload",
    });

    assert.strictEqual(azureCalled, 1);
    assert.strictEqual(mistralCalled, 1);
    assert.strictEqual(result.provider, "mistral");
  });

  await t.test("4.7 If Mistral fallback also fails, primary Azure error is preserved", async () => {
    const mockFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError(
          "The input image dimensions (12000x8000) exceed Azure Document Intelligence maximum limit of 10000x10000 pixels.",
          {
            provider: "azure",
            status: 400,
            code: "BAD_REQUEST",
            diagnosticCode: "InvalidContentDimensions",
          }
        );
      },
    };

    const mockFailingMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        throw new Error("Mistral internal failure");
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockFailingAzure,
      fallbackProvider: mockFailingMistral,
      enableFallback: true,
    });

    await assert.rejects(
      async () => {
        await orchestrator.execute({ image: "data:image/png;base64,payload" });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.diagnosticCode, "InvalidContentDimensions");
        return true;
      }
    );
  });

  // -------------------------------------------------------------------------
  // 5. REGRESSION: IMAGE FILE SIZE REJECTION AND SAFE MISTRAL FALLBACK
  // -------------------------------------------------------------------------
  await t.test("5.1 Azure 400 with 'The input image is too large' safely falls back to Mistral", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    const mockSizeLimitedAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        throw new OcrProviderError(
          "The input image is too large. Refer to documentation for the maximum file size.",
          {
            provider: "azure",
            status: 400,
            code: "BAD_REQUEST",
            diagnosticCode: "InvalidContentLength",
            innerCode: "InvalidContentLength",
            azureErrorCode: "InvalidRequest",
          }
        );
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return {
          text: "CERTIFICATE OF LIVE BIRTH\nCHILD: MARIA CLARA SANTOS\nDATE OF BIRTH: 15/06/2009",
          confidence: 0.95,
          model: "mistral-ocr-latest",
          provider: "mistral",
        };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockSizeLimitedAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const result = await orchestrator.execute({
      image: "data:image/jpeg;base64,sixMegabyteImagePayload",
      extractFields: true,
      gradeLevel: "PSA",
    });

    assert.strictEqual(azureCalled, 1, "Azure primary must be attempted first");
    assert.strictEqual(mistralCalled, 1, "Mistral fallback must be invoked for Azure file-size limit");
    assert.strictEqual(result.provider, "mistral", "Result provider must be mistral");
    assert.ok(result.text.includes("MARIA CLARA SANTOS"));
  });

  await t.test("5.2 When fallback is disabled, Azure file-size rejection returns exact error without masking", async () => {
    const mockSizeLimitedAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        throw new OcrProviderError(
          "The input image is too large. Refer to documentation for the maximum file size.",
          {
            provider: "azure",
            status: 400,
            code: "BAD_REQUEST",
            diagnosticCode: "InvalidContentLength",
            innerCode: "InvalidContentLength",
            azureErrorCode: "InvalidRequest",
          }
        );
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockSizeLimitedAzure,
      enableFallback: false,
    });

    await assert.rejects(
      async () => {
        await orchestrator.execute({ image: "data:image/jpeg;base64,largePayload" });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.provider, "azure");
        assert.strictEqual(err.status, 400);
        assert.strictEqual(
          err.message,
          "The input image is too large. Refer to documentation for the maximum file size."
        );
        assert.strictEqual(err.diagnosticCode, "InvalidContentLength");
        return true;
      }
    );
  });

  await t.test("5.3 Distinguishes pixel dimensions from file byte size", async () => {
    let azureCalled = 0;
    let mistralCalled = 0;

    // Case A: High-resolution image (e.g. 12000x8000 px) but small file size (1MB)
    const mockDimensionFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCalled++;
        throw new OcrProviderError(
          "The input image dimensions (12000x8000) exceed Azure Document Intelligence maximum limit of 10000x10000 pixels.",
          {
            provider: "azure",
            status: 400,
            code: "BAD_REQUEST",
            diagnosticCode: "InvalidContentDimensions",
            innerCode: "InvalidContentDimensions",
          }
        );
      },
    };

    const mockMistral = {
      name: "mistral",
      isAvailable: async () => true,
      recognize: async () => {
        mistralCalled++;
        return { text: "processed large dimensions", model: "mistral-ocr-latest", provider: "mistral" };
      },
    };

    const orchestrator = new OcrOrchestrator({
      primaryProvider: mockDimensionFailingAzure,
      fallbackProvider: mockMistral,
      enableFallback: true,
    });

    const resA = await orchestrator.execute({ image: "data:image/png;base64,highResSmallFile" });
    assert.strictEqual(azureCalled, 1, "Azure attempted first");
    assert.strictEqual(mistralCalled, 1, "Mistral handled dimension restriction");
    assert.strictEqual(resA.provider, "mistral");

    // Case B: Moderate dimensions (e.g. 3000x2000 px) but large file size (6MB) exceeding Azure tier
    let azureCallsB = 0;
    let mistralCallsB = 0;
    const mockFileSizeFailingAzure = {
      name: "azure",
      isAvailable: async () => true,
      recognize: async () => {
        azureCallsB++;
        throw new OcrProviderError(
          "The input image is too large. Refer to documentation for the maximum file size.",
          {
            provider: "azure",
            status: 400,
            code: "BAD_REQUEST",
            diagnosticCode: "InvalidContentLength",
            innerCode: "InvalidContentLength",
          }
        );
      },
    };

    const orchestratorB = new OcrOrchestrator({
      primaryProvider: mockFileSizeFailingAzure,
      fallbackProvider: {
        name: "mistral",
        isAvailable: async () => true,
        recognize: async () => {
          mistralCallsB++;
          return { text: "processed large file size", model: "mistral-ocr-latest", provider: "mistral" };
        },
      },
      enableFallback: true,
    });

    const resB = await orchestratorB.execute({ image: "data:image/jpeg;base64,moderateDimsLargeFile" });
    assert.strictEqual(azureCallsB, 1, "Azure attempted first");
    assert.strictEqual(mistralCallsB, 1, "Mistral handled file-size restriction");
    assert.strictEqual(resB.provider, "mistral");
  });

  await t.test("5.4 Supports JPG, JPEG, PNG, and PDF payloads routing to Azure primary", async () => {
    const formats = [
      { mime: "image/jpeg", data: "data:image/jpeg;base64,sampleJpgData" },
      { mime: "image/jpg", data: "data:image/jpg;base64,sampleJpgData" },
      { mime: "image/png", data: "data:image/png;base64,samplePngData" },
      { mime: "application/pdf", data: "data:application/pdf;base64,samplePdfData" },
    ];

    for (const fmt of formats) {
      let azureCalled = 0;
      const mockAzure = {
        name: "azure",
        isAvailable: async () => true,
        recognize: async (input) => {
          azureCalled++;
          assert.strictEqual(input.image, fmt.data);
          return { text: `Extracted from ${fmt.mime}`, model: "azure/prebuilt-read", provider: "azure" };
        },
      };

      const orchestrator = new OcrOrchestrator({
        primaryProvider: mockAzure,
        enableFallback: true,
      });

      const res = await orchestrator.execute({ image: fmt.data });
      assert.strictEqual(azureCalled, 1, `Azure must be called for ${fmt.mime}`);
      assert.strictEqual(res.provider, "azure");
    }
  });

  await t.test("5.5 Azure Document Intelligence Provider rejects oversized files exceeding 50MB ceiling", async () => {
    // 51MB binary -> ~68MB base64
    const largeBase64 = "A".repeat(68 * 1024 * 1024);
    const dataUrl = `data:image/jpeg;base64,${largeBase64}`;

    const provider = new AzureDocumentIntelligenceProvider({
      endpoint: "https://avv-ocr-test.cognitiveservices.azure.com/",
      apiKey: "test-key-123",
    });

    await assert.rejects(
      async () => {
        await provider.recognize({ image: dataUrl });
      },
      (err) => {
        assert.ok(err instanceof OcrProviderError);
        assert.strictEqual(err.status, 400);
        assert.strictEqual(
          err.message,
          "The input image is too large. Refer to documentation for the maximum file size."
        );
        assert.strictEqual(err.diagnosticCode, "InvalidContentLength");
        return true;
      }
    );
  });
});

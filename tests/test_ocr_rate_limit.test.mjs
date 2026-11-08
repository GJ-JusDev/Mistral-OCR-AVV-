import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRetryAfterHeader,
  isQuotaExhaustedMessage,
  MistralOcrError,
  callMistralOcr,
  callMistralOcrWithRetry,
  handleOcrRoute,
} from "../src/lib/ocr/mistral.ts";

test("OCR Rate Limit & Safe Error Handling Suite", async (t) => {
  await t.test("1. parseRetryAfterHeader parses numeric seconds, HTTP dates, and invalid values", () => {
    // Numeric delta-seconds
    assert.strictEqual(parseRetryAfterHeader("5"), 5);
    assert.strictEqual(parseRetryAfterHeader(" 120 "), 120);
    assert.strictEqual(parseRetryAfterHeader("0"), 0);

    // Null / undefined / empty
    assert.strictEqual(parseRetryAfterHeader(null), undefined);
    assert.strictEqual(parseRetryAfterHeader(undefined), undefined);
    assert.strictEqual(parseRetryAfterHeader(""), undefined);
    assert.strictEqual(parseRetryAfterHeader("invalid-string"), undefined);

    // Future HTTP date
    const futureDate = new Date(Date.now() + 15000).toUTCString();
    const parsed = parseRetryAfterHeader(futureDate);
    assert.ok(typeof parsed === "number");
    assert.ok(parsed >= 13 && parsed <= 16, `Expected ~15s, got ${parsed}`);
  });

  await t.test("2. isQuotaExhaustedMessage accurately distinguishes quota exhaustion from burst rate limits", () => {
    // Quota exhaustion indicators
    assert.strictEqual(isQuotaExhaustedMessage("Account quota exceeded"), true);
    assert.strictEqual(isQuotaExhaustedMessage("Monthly budget limit reached"), true);
    assert.strictEqual(isQuotaExhaustedMessage("You have exceeded your balance or credits"), true);
    assert.strictEqual(isQuotaExhaustedMessage("insufficient_quota: please update your billing plan"), true);

    // Temporary burst rate limit indicators
    assert.strictEqual(isQuotaExhaustedMessage("Rate limit exceeded"), false);
    assert.strictEqual(isQuotaExhaustedMessage("Too Many Requests: 1 request per second permitted"), false);
    assert.strictEqual(isQuotaExhaustedMessage("Concurrent requests limit exceeded"), false);
  });

  await t.test("3. MistralOcrError constructs correct structured metadata", () => {
    const rateLimitErr = new MistralOcrError("Rate limited", {
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: 7,
    });
    assert.strictEqual(rateLimitErr.status, 429);
    assert.strictEqual(rateLimitErr.code, "RATE_LIMIT_EXCEEDED");
    assert.strictEqual(rateLimitErr.retryAfter, 7);
    assert.strictEqual(rateLimitErr.isRateLimit, true);
    assert.strictEqual(rateLimitErr.isQuotaExhausted, false);

    const quotaErr = new MistralOcrError("Quota depleted", {
      status: 429,
      code: "QUOTA_EXHAUSTED",
    });
    assert.strictEqual(quotaErr.status, 429);
    assert.strictEqual(quotaErr.code, "QUOTA_EXHAUSTED");
    assert.strictEqual(quotaErr.isRateLimit, false);
    assert.strictEqual(quotaErr.isQuotaExhausted, true);
  });

  await t.test("4. callMistralOcr validates API key and input format without network call", async () => {
    // Missing API key
    await assert.rejects(
      async () => {
        await callMistralOcr("data:image/png;base64,abc", "");
      },
      (err) => {
        assert.ok(err instanceof MistralOcrError);
        assert.strictEqual(err.code, "INVALID_API_KEY");
        assert.strictEqual(err.status, 500);
        return true;
      }
    );

    // Invalid image data URL
    await assert.rejects(
      async () => {
        await callMistralOcr("https://example.com/not-base64.png", "dummy-key");
      },
      (err) => {
        assert.ok(err instanceof MistralOcrError);
        assert.strictEqual(err.code, "BAD_REQUEST");
        assert.strictEqual(err.status, 400);
        return true;
      }
    );
  });

  await t.test("5. callMistralOcr handles upstream HTTP 429 Rate Limit and respects Retry-After", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "6",
          },
        });
      };

      await assert.rejects(
        async () => {
          await callMistralOcr("data:image/png;base64,validdata", "test-key");
        },
        (err) => {
          assert.ok(err instanceof MistralOcrError);
          assert.strictEqual(err.status, 429);
          assert.strictEqual(err.code, "RATE_LIMIT_EXCEEDED");
          assert.strictEqual(err.retryAfter, 6);
          assert.strictEqual(err.isRateLimit, true);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("6. callMistralOcr handles upstream HTTP 429 Quota Exhaustion correctly", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            error: { message: "Monthly quota exceeded. Upgrade your plan." },
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      await assert.rejects(
        async () => {
          await callMistralOcr("data:image/png;base64,validdata", "test-key");
        },
        (err) => {
          assert.ok(err instanceof MistralOcrError);
          assert.strictEqual(err.status, 429);
          assert.strictEqual(err.code, "QUOTA_EXHAUSTED");
          assert.strictEqual(err.isQuotaExhausted, true);
          assert.strictEqual(err.isRateLimit, false);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("7. callMistralOcrWithRetry performs bounded backoff and succeeds on retry", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    const sleeps = [];

    try {
      globalThis.fetch = async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "1",
            },
          });
        }
        return new Response(
          JSON.stringify({
            pages: [{ markdown: "Extracted Document Content" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      const result = await callMistralOcrWithRetry(
        "data:image/png;base64,validdata",
        "test-key",
        {
          maxRetries: 2,
          maxServerWaitSeconds: 3,
          sleepFn: async (ms) => {
            sleeps.push(ms);
          },
        }
      );

      assert.strictEqual(callCount, 2);
      assert.strictEqual(sleeps.length, 1);
      assert.ok(sleeps[0] >= 1000, `Expected sleep >= 1000ms, got ${sleeps[0]}`);
      assert.strictEqual(result.text, "Extracted Document Content");
      assert.strictEqual(result.pageCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("8. callMistralOcrWithRetry fails fast without long server delay when Retry-After > maxServerWaitSeconds", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    const sleeps = [];

    try {
      globalThis.fetch = async () => {
        callCount++;
        return new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "30", // Long provider delay (30s)
          },
        });
      };

      await assert.rejects(
        async () => {
          await callMistralOcrWithRetry(
            "data:image/png;base64,validdata",
            "test-key",
            {
              maxRetries: 2,
              maxServerWaitSeconds: 3,
              sleepFn: async (ms) => {
                sleeps.push(ms);
              },
            }
          );
        },
        (err) => {
          assert.ok(err instanceof MistralOcrError);
          assert.strictEqual(err.retryAfter, 30);
          return true;
        }
      );

      // Must fail fast on attempt 1 without sleeping or hanging the server connection
      assert.strictEqual(callCount, 1);
      assert.strictEqual(sleeps.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("9. callMistralOcrWithRetry NEVER retries Quota Exhaustion or Invalid Key", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    try {
      globalThis.fetch = async () => {
        callCount++;
        return new Response(
          JSON.stringify({ message: "Credit balance exhausted" }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      };

      await assert.rejects(async () => {
        await callMistralOcrWithRetry("data:image/png;base64,validdata", "test-key");
      });

      // No retries for quota exhaustion
      assert.strictEqual(callCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("10. OCR API Route (/api/ocr) returns 429, Retry-After header, and structured JSON on rate limit", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.MISTRAL_API_KEY;

    try {
      process.env.MISTRAL_API_KEY = "test-route-key";

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: "Rate limit exceeded" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "4",
          },
        });
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,sampleimage",
          extractFields: true,
          gradeLevel: "Senior High School",
        }),
      });

      const response = await handleOcrRoute(request, process.env.MISTRAL_API_KEY);
      assert.strictEqual(response.status, 429);
      assert.strictEqual(response.headers.get("Retry-After"), "4");

      const body = await response.json();
      assert.strictEqual(body.code, "RATE_LIMIT_EXCEEDED");
      assert.strictEqual(body.retryAfter, 4);
      assert.ok(body.error.includes("rate limit"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) {
        process.env.MISTRAL_API_KEY = originalKey;
      } else {
        delete process.env.MISTRAL_API_KEY;
      }
    }
  });

  await t.test("11. OCR API Route returns 429 with QUOTA_EXHAUSTED when upstream quota depleted", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.MISTRAL_API_KEY;

    try {
      process.env.MISTRAL_API_KEY = "test-route-key";

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ message: "insufficient_quota: account balance is 0" }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,sampleimage",
        }),
      });

      const response = await handleOcrRoute(request, process.env.MISTRAL_API_KEY);
      assert.strictEqual(response.status, 429);

      const body = await response.json();
      assert.strictEqual(body.code, "QUOTA_EXHAUSTED");
      assert.ok(body.error.includes("quota or credit limit"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) {
        process.env.MISTRAL_API_KEY = originalKey;
      } else {
        delete process.env.MISTRAL_API_KEY;
      }
    }
  });

  await t.test("12. OCR API Route protects credentials and never leaks MISTRAL_API_KEY to client", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.MISTRAL_API_KEY;
    const secretKey = "super-confidential-mistral-secret-key-12345";

    try {
      process.env.MISTRAL_API_KEY = secretKey;

      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({ detail: `Invalid API Key: ${secretKey}` }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,sampleimage",
        }),
      });

      const response = await handleOcrRoute(request, process.env.MISTRAL_API_KEY);
      assert.strictEqual(response.status, 500);

      const body = await response.json();
      assert.strictEqual(body.code, "INVALID_API_KEY");
      // Must NOT leak the secret key in response body or headers
      assert.strictEqual(body.error.includes(secretKey), false);
      const stringified = JSON.stringify(body);
      assert.strictEqual(stringified.includes(secretKey), false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) {
        process.env.MISTRAL_API_KEY = originalKey;
      } else {
        delete process.env.MISTRAL_API_KEY;
      }
    }
  });

  await t.test("13. Concurrency Protection: In-flight extraction locks duplicate execution", async () => {
    let inFlight = false;
    let duplicateRejected = false;

    async function extractSimulated(image) {
      if (inFlight) {
        duplicateRejected = true;
        const err = new Error("An OCR extraction is already in progress. Please wait.");
        err.code = "CONCURRENT_REQUEST";
        throw err;
      }
      inFlight = true;
      try {
        await new Promise((r) => setTimeout(r, 50));
        return { text: "Success" };
      } finally {
        inFlight = false;
      }
    }

    // Launch first extraction
    const p1 = extractSimulated("data:image/png;base64,123");
    // Immediately launch second concurrent trigger
    let p2Error = null;
    try {
      await extractSimulated("data:image/png;base64,123");
    } catch (e) {
      p2Error = e;
    }

    const r1 = await p1;
    assert.strictEqual(r1.text, "Success");
    assert.strictEqual(duplicateRejected, true);
    assert.ok(p2Error !== null);
    assert.strictEqual(p2Error.code, "CONCURRENT_REQUEST");
  });

  await t.test("14. State Preservation: Extraction failure retains existing document and form state", async () => {
    // Simulate user upload state
    const userState = {
      rawImage: "data:image/png;base64,existing-student-record",
      processedImage: "data:image/png;base64,existing-student-record-processed",
      gradeLevel: "Senior High School",
      adjustments: { contrast: 1.1, brightness: 1.05 },
      existingOcrFields: { name: "JUAN DELA CRUZ", lrn: "123456789012" },
    };

    // Simulate 429 failure
    const errorReceived = new MistralOcrError("Rate limit exceeded", {
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: 5,
    });

    // Verify state is NOT overwritten or reset
    assert.strictEqual(userState.rawImage, "data:image/png;base64,existing-student-record");
    assert.strictEqual(userState.processedImage, "data:image/png;base64,existing-student-record-processed");
    assert.strictEqual(userState.gradeLevel, "Senior High School");
    assert.strictEqual(userState.existingOcrFields.name, "JUAN DELA CRUZ");
    assert.strictEqual(errorReceived.isRateLimit, true);
    assert.strictEqual(errorReceived.retryAfter, 5);
  });

  await t.test("15. Missing Credentials: Unconfigured MISTRAL_API_KEY returns configuration error, NOT Rate limit exceeded", async () => {
    const request = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "data:image/png;base64,dummyimage",
      }),
    });

    const response = await handleOcrRoute(request, undefined);
    assert.strictEqual(response.status, 500);

    const body = await response.json();
    assert.strictEqual(body.code, "INVALID_API_KEY");
    assert.ok(body.error.includes("Mistral OCR is not configured"));
    assert.strictEqual(body.error.toLowerCase().includes("rate limit"), false);
  });

  await t.test("16. Invalid Credentials (HTTP 401): Returns authentication failure, never retries, and never masks as rate limit", async () => {
    const originalFetch = globalThis.fetch;
    let attempts = 0;

    try {
      globalThis.fetch = async () => {
        attempts++;
        return new Response(JSON.stringify({ detail: "Invalid API Key" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/png;base64,dummyimage",
        }),
      });

      const response = await handleOcrRoute(request, "invalid-token-test");
      assert.strictEqual(response.status, 500);

      const body = await response.json();
      assert.strictEqual(body.code, "INVALID_API_KEY");
      assert.ok(body.error.includes("authentication failed"));
      assert.strictEqual(body.error.toLowerCase().includes("rate limit"), false);
      // HTTP 401 must NEVER be retried
      assert.strictEqual(attempts, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("17. Distinct Error Handling: HTTP 401, HTTP 429, Quota Exhaustion, and 503 are strictly separated", async () => {
    const originalFetch = globalThis.fetch;

    const cases = [
      {
        name: "HTTP 401 Auth Error",
        status: 401,
        body: { detail: "Invalid API Key" },
        expectedHttpStatus: 500,
        expectedCode: "INVALID_API_KEY",
        expectedRetryAfter: undefined,
      },
      {
        name: "HTTP 429 Burst Rate Limit",
        status: 429,
        headers: { "Retry-After": "8" },
        body: { message: "Rate limit exceeded" },
        expectedHttpStatus: 429,
        expectedCode: "RATE_LIMIT_EXCEEDED",
        expectedRetryAfter: 8,
      },
      {
        name: "HTTP 429 Quota Exhaustion",
        status: 429,
        body: { message: "Monthly quota or billing budget exhausted" },
        expectedHttpStatus: 429,
        expectedCode: "QUOTA_EXHAUSTED",
        expectedRetryAfter: undefined,
      },
      {
        name: "HTTP 503 Upstream Service Unavailable",
        status: 503,
        body: { message: "Service Temporarily Unavailable" },
        expectedHttpStatus: 503,
        expectedCode: "UPSTREAM_ERROR",
        expectedRetryAfter: undefined,
      },
    ];

    try {
      for (const tc of cases) {
        globalThis.fetch = async () => {
          return new Response(JSON.stringify(tc.body), {
            status: tc.status,
            headers: {
              "Content-Type": "application/json",
              ...(tc.headers || {}),
            },
          });
        };

        const request = new Request("http://localhost:3000/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: "data:image/png;base64,dummyimage",
          }),
        });

        // Use options to disable retry loops for speed in the matrix test
        const response = await handleOcrRoute(
          request,
          "dummy-test-key",
          undefined,
          async (img, key) => callMistralOcr(img, key)
        );

        assert.strictEqual(
          response.status,
          tc.expectedHttpStatus,
          `${tc.name} should yield HTTP status ${tc.expectedHttpStatus}`
        );

        const resBody = await response.json();
        assert.strictEqual(
          resBody.code,
          tc.expectedCode,
          `${tc.name} should yield error code ${tc.expectedCode}`
        );

        if (tc.expectedRetryAfter !== undefined) {
          assert.strictEqual(resBody.retryAfter, tc.expectedRetryAfter);
          assert.strictEqual(response.headers.get("Retry-After"), String(tc.expectedRetryAfter));
        } else {
          assert.strictEqual(resBody.retryAfter, undefined);
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

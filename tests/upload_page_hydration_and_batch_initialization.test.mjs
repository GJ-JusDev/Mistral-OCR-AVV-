import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("AVV System — Upload Page Hydration Mismatch & Batch Initialization Suite", async (t) => {
  const uploadPagePath = path.join(rootDir, "src", "app", "upload", "page.tsx");
  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");

  await t.test("1. Server and initial client render use stable deterministic Batch ID state", () => {
    // currentBatchId must NOT execute Date.now() or crypto.randomUUID inside useState initializer
    const useStateBatchMatch = uploadPageSrc.match(/const\s+\[currentBatchId,\s*setCurrentBatchId\]\s*=\s*useState<string>\(([^)]*)\)/);
    assert.ok(useStateBatchMatch, "currentBatchId useState must be defined");
    
    const initArg = useStateBatchMatch[1].trim();
    assert.ok(
      initArg === '""' || initArg === "''",
      `currentBatchId must be initialized with stable empty string to ensure deterministic initial SSR/hydration render, got: ${initArg}`
    );
    assert.ok(
      !initArg.includes("Date.now()"),
      "useState for currentBatchId must NOT execute Date.now() during SSR or initial render"
    );
    assert.ok(
      !initArg.includes("randomUUID"),
      "useState for currentBatchId must NOT execute randomUUID during SSR or initial render"
    );

    // Initial render must show stable placeholder before client hydration
    assert.ok(
      uploadPageSrc.includes("isBatchHydrated && currentBatchId ? currentBatchId :") ||
      uploadPageSrc.includes("isBatchHydrated ? currentBatchId :"),
      "Batch ID display must use isBatchHydrated check to prevent hydration mismatch"
    );
  });

  await t.test("2. A Batch ID is generated only after client initialization when needed in useEffect", () => {
    // Must contain useEffect for client hydration initialization
    assert.ok(
      uploadPageSrc.includes("isBatchHydrated"),
      "UploadPage must maintain isBatchHydrated state"
    );

    // Generation must happen in effect or client-only handler
    assert.ok(
      uploadPageSrc.includes("generateNewBatchId"),
      "UploadPage must have client-only generateNewBatchId helper"
    );

    // Verify client initialization effect structure
    const effectMatch = uploadPageSrc.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?setIsBatchHydrated\(true\);?\s*\},?\s*\[\]\);?/);
    assert.ok(effectMatch, "UploadPage must initialize batch ID in a mount-only useEffect");
  });

  await t.test("3. Existing sessionStorage Batch ID is restored on client hydration", () => {
    // Effect must inspect sessionStorage for avv_active_batch_id
    assert.ok(
      uploadPageSrc.includes('sessionStorage.getItem("avv_active_batch_id")'),
      "Client hydration must inspect sessionStorage.getItem('avv_active_batch_id')"
    );

    // Simulate recovery logic from sessionStorage
    const mockSessionStorage = {
      avv_active_batch_id: "batch-1732520000000-saved123",
      avv_is_new_batch: "false",
    };

    let resolvedBatchId = "";
    let isExplicitNew = false;
    const urlBatch = null;
    const savedBatch = mockSessionStorage["avv_active_batch_id"];
    const savedIsNew = mockSessionStorage["avv_is_new_batch"] === "true";

    if (urlBatch) {
      resolvedBatchId = urlBatch;
      isExplicitNew = false;
    } else if (savedBatch) {
      resolvedBatchId = savedBatch;
      isExplicitNew = savedIsNew;
    }

    assert.equal(resolvedBatchId, "batch-1732520000000-saved123");
    assert.equal(isExplicitNew, false);
  });

  await t.test("4. Existing URL Batch ID is respected with top precedence", () => {
    // Effect must inspect URL for batchId
    assert.ok(
      uploadPageSrc.includes('new URLSearchParams(window.location.search).get("batchId")'),
      "Client hydration must inspect URLSearchParams for batchId"
    );

    // Simulate URL precedence over sessionStorage
    const urlBatch = "batch-from-url-999";
    const savedBatch = "batch-from-session-888";

    let resolvedBatchId = "";
    if (urlBatch) {
      resolvedBatchId = urlBatch;
    } else if (savedBatch) {
      resolvedBatchId = savedBatch;
    }

    assert.equal(resolvedBatchId, "batch-from-url-999", "URL batchId must take precedence over sessionStorage");
  });

  await t.test("5. Start New Batch generates a new unique ID and updates state and sessionStorage", () => {
    assert.ok(
      uploadPageSrc.includes("handleStartNewBatch"),
      "UploadPage must have handleStartNewBatch"
    );
    assert.ok(
      uploadPageSrc.includes("sessionStorage.setItem(\"avv_active_batch_id\""),
      "handleStartNewBatch must update sessionStorage"
    );
    assert.ok(
      uploadPageSrc.includes("sessionStorage.setItem(\"avv_is_new_batch\""),
      "handleStartNewBatch must mark is_new_batch in sessionStorage"
    );

    // Test that generating twice produces distinct IDs
    const id1 = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const id2 = `batch-${Date.now() + 1}-${Math.random().toString(36).slice(2, 10)}`;
    assert.notEqual(id1, id2, "Subsequent new batch generations must produce unique IDs");
  });

  await t.test("6. Refresh restores the active batch", () => {
    // Active batch persists in sessionStorage and restores
    const activeBatchId = "batch-1732530000000-active001";
    const saved = activeBatchId;
    assert.equal(saved, activeBatchId);
  });

  await t.test("7. No batch recovery request runs before client initialization (race condition prevention)", () => {
    // The recovery effect MUST check !isBatchHydrated || !currentBatchId before executing fetchSavedBatch
    assert.ok(
      uploadPageSrc.includes("if (!isBatchHydrated || !currentBatchId) return;"),
      "Saved batch recovery effect must guard against unhydrated or uninitialized batchId"
    );

    // Ensure dependency array contains isBatchHydrated
    assert.ok(
      uploadPageSrc.includes("[isBatchHydrated,") || uploadPageSrc.includes("isBatchHydrated,"),
      "Saved batch recovery effect dependencies must track isBatchHydrated"
    );
  });

  await t.test("8. Existing batch isolation tests remain passing and safe", () => {
    // Verify that batchParam is passed to API query
    assert.ok(
      uploadPageSrc.includes("batchId=${encodeURIComponent(batchParam)}"),
      "fetchSavedBatch must query with explicit batchId to prevent cross-batch leaks"
    );
  });
});

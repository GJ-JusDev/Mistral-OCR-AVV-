/**
 * End-to-End Routing Verification Script
 * Verifies that handleOcrRoute in Next.js routes directly to Azure Document Intelligence
 * when OCR_PRIMARY_PROVIDER="azure" and falls back to Mistral OCR when enabled.
 */
import fs from "node:fs";
import path from "node:path";
import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

// Load .env.local if present
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

async function runLiveVerification() {
  console.log("=== Live E2E Routing Verification (Azure -> Mistral) ===");

  process.env.OCR_PRIMARY_PROVIDER = "azure";
  process.env.OCR_FALLBACK_PROVIDER = "mistral";

  const samplePath = path.resolve("../local-ocr/samples/sample_handwriting.png");
  if (!fs.existsSync(samplePath)) {
    throw new Error(`Sample image not found at ${samplePath}`);
  }
  const b64 = fs.readFileSync(samplePath).toString("base64");
  const dataUrl = `data:image/png;base64,${b64}`;

  console.log(`1. Sending OCR request through Next.js handleOcrRoute (OCR_PRIMARY_PROVIDER=azure)...`);
  const req = new Request("http://localhost:3000/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: dataUrl,
      extractFields: true,
      gradeLevel: "Grade 11",
    }),
  });

  const t0 = Date.now();
  const response = await handleOcrRoute(
    req,
    process.env.MISTRAL_API_KEY,
    parseGradesText
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`2. Response received in ${elapsed}s with HTTP status ${response.status}`);
  const body = await response.json();
  console.log("3. Response payload:", JSON.stringify(body, null, 2));

  if (response.status !== 200) {
    throw new Error(`Expected HTTP 200, got ${response.status}`);
  }
  if (body.provider !== "azure" && body.provider !== "mistral") {
    throw new Error(`Expected provider 'azure' or 'mistral', got '${body.provider}'`);
  }

  console.log("\n=== SUCCESS: Next.js route handler verified with Cloud OCR pipeline! ===");
}

runLiveVerification().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});

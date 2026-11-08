import fs from "node:fs";
import path from "node:path";
import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";
import { MistralOcrProvider } from "../src/lib/ocr/providers/mistralProvider.ts";
import { OcrOrchestrator } from "../src/lib/ocr/providers/orchestrator.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

// Parse .env.local manually to inject credentials
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

console.log("=== AVV LIVE AZURE DOCUMENT INTELLIGENCE VERIFICATION ===");
console.log("Primary Provider Env:", process.env.OCR_PRIMARY_PROVIDER);
console.log("Fallback Provider Env:", process.env.OCR_FALLBACK_PROVIDER);
console.log("Azure Endpoint:", process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT);
console.log("Azure Key Configured:", Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY));
console.log("Mistral Key Configured:", Boolean(process.env.MISTRAL_API_KEY));

const samplePath = path.resolve(process.cwd(), "../local-ocr/samples/sample_handwriting.png");
const imageBytes = fs.readFileSync(samplePath);
const dataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;

async function runVerification() {
  const azure = new AzureDocumentIntelligenceProvider();
  const mistral = new MistralOcrProvider();

  console.log("\n1. Checking Provider Availability...");
  const azureReady = await azure.isAvailable();
  const mistralReady = await mistral.isAvailable();
  console.log(`   - Azure Available:   ${azureReady}`);
  console.log(`   - Mistral Available: ${mistralReady}`);

  console.log("\n2. Executing Live Azure OCR Request via OcrOrchestrator...");
  const orchestrator = new OcrOrchestrator();
  const startMs = Date.now();
  const result = await orchestrator.execute({
    image: dataUrl,
    extractFields: true,
    gradeLevel: "Senior High School",
  });
  const elapsedMs = Date.now() - startMs;

  console.log(`   - Completed in: ${elapsedMs}ms`);
  console.log(`   - Provider Used: ${result.provider}`);
  console.log(`   - Model Used:    ${result.model}`);
  console.log(`   - Avg Word Conf: ${result.confidence !== undefined ? (result.confidence * 100).toFixed(2) + "%" : "Unmeasured"}`);
  console.log(`   - Page Count:    ${result.pageCount}`);
  console.log(`   - Extracted Text:\n     "${result.text.replace(/\n/g, " | ")}"`);

  const parsedFields = parseGradesText(result.text, "Senior High School");
  console.log("   - Parsed Candidate Fields:", JSON.stringify(parsedFields));

  console.log("\n3. Verifying Fallback Path (Simulating Azure Failure -> Mistral Fallback)...");
  const failingAzure = new AzureDocumentIntelligenceProvider({
    endpoint: "https://invalid-endpoint-test.cognitiveservices.azure.com/",
    apiKey: "invalid-key",
    timeoutMs: 2500,
  });

  // Override recognize to simulate 503 outage
  failingAzure.recognize = async () => {
    const err = new Error("Simulated Azure 503 Service Unavailable");
    err.status = 503;
    err.code = "SERVICE_UNAVAILABLE";
    throw err;
  };

  const fallbackOrchestrator = new OcrOrchestrator({
    primaryProvider: failingAzure,
    fallbackProvider: mistral,
    enableFallback: true,
  });

  const fbStartMs = Date.now();
  const fbResult = await fallbackOrchestrator.execute({
    image: dataUrl,
  });
  const fbElapsedMs = Date.now() - fbStartMs;

  console.log(`   - Fallback Completed in: ${fbElapsedMs}ms`);
  console.log(`   - Fallback Provider Used: ${fbResult.provider}`);
  console.log(`   - Fallback Model Used:    ${fbResult.model}`);
  console.log(`   - Fallback Confidence:    ${fbResult.confidence ?? "undefined (Unmeasured)"}`);
  console.log(`   - Fallback Text:\n     "${fbResult.text.replace(/\n/g, " | ")}"`);

  console.log("\n=== LIVE VERIFICATION COMPLETE ===");
}

runVerification().catch((err) => {
  console.error("Live verification failed:", err);
  process.exit(1);
});

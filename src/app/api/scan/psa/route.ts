import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePsaBirthCert } from "@/lib/ocr/psaParser";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { getImageDimensionsFromBuffer } from "@/lib/ocr/providers/azureProvider";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function validateImagePayload(img: any): { error?: string; status?: number; mimeType?: string; base64Content?: string } {
  if (typeof img !== "string") {
    return { error: "A valid base64 image or PDF data URL is required.", status: 400 };
  }
  const match = img.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!match) {
    return { error: "Invalid data URL format. A valid base64 image or PDF data URL is required.", status: 400 };
  }
  const mimeType = match[1].toLowerCase();
  const base64Content = match[2];
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { error: `Unsupported document format (${mimeType}). Allowed formats are JPEG, PNG, WebP, and PDF.`, status: 400 };
  }
  if (!base64Content || base64Content.trim().length === 0) {
    return { error: "Document payload cannot be empty.", status: 400 };
  }
  // Application payload size check (up to 35MB document payload)
  if (base64Content.length > 50 * 1024 * 1024) {
    return { error: "Document payload exceeds the maximum supported file size limit of 35MB.", status: 400 };
  }

  // Pre-validate image dimensions for PNG and JPEG (reject corrupt or microscopic payloads)
  if (mimeType.startsWith("image/")) {
    try {
      const buf = Buffer.from(base64Content, "base64");
      const dims = getImageDimensionsFromBuffer(buf, mimeType);
      if (dims) {
        if (dims.width < 50 || dims.height < 50) {
          return {
            error: `The input image dimensions (${dims.width}x${dims.height}) are too small. Minimum supported dimension is 50x50 pixels.`,
            status: 400,
          };
        }
      }
    } catch {
      // Non-blocking dimension check fallback
    }
  }

  return { mimeType, base64Content };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // 1. Authenticate user and verify Teacher role (Strict RBAC)
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json(
          { error: "Unauthorized: Please log in to scan documents.", code: "UNAUTHORIZED" },
          { status: 401 }
        );
      }

      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role, account_status, school_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!roleRow || roleRow.account_status !== "Approved") {
        return NextResponse.json(
          { error: "Forbidden: Account is pending administrator approval.", code: "ACCOUNT_NOT_APPROVED" },
          { status: 403 }
        );
      }

      const role = (roleRow.role || "").toLowerCase().trim();

      if (role === "admin" || role === "administrator") {
        return NextResponse.json(
          {
            error: "Forbidden: Administrator role cannot scan or upload documents. Scanning permissions are strictly assigned to authorized Teachers.",
            code: "ADMIN_CANNOT_SCAN",
          },
          { status: 403 }
        );
      }

      if (role === "principal") {
        return NextResponse.json(
          {
            error: "Forbidden: Principal role is monitoring-only and cannot initiate OCR scans.",
            code: "PRINCIPAL_READ_ONLY",
          },
          { status: 403 }
        );
      }

      if (role !== "teacher") {
        return NextResponse.json(
          {
            error: "Forbidden: Only authorized Teachers may scan PSA birth certificate documents.",
            code: "UNAUTHORIZED_ROLE",
          },
          { status: 403 }
        );
      }
    } catch (authError) {
      console.error("PSA scan authorization error:", authError);
      return NextResponse.json(
        { error: "Forbidden: Unable to verify scanning authorization.", code: "AUTH_CHECK_FAILED" },
        { status: 403 }
      );
    }

    // 2. Parse request payload
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request payload: could not parse JSON.", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const { image, frontImage, backImage, childSectionImage, childNameImage, rawText, isPreprocessed } = body || {};

  // 3. Fast-path: Direct raw text OCR testing (used in synthetic tests or debug)
  if (typeof rawText === "string" && rawText.trim().length > 0) {
    const parsed = parsePsaBirthCert(rawText);
    return NextResponse.json({
      success: true,
      text: rawText,
      identity: parsed.identity,
      field_statuses: parsed.field_statuses,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      model: "text-direct",
      provider: "direct-parser",
      test_mode: true,
      persisted: false,
    });
  }

  // 4. Validate image / document payload
  const primaryImage = image || frontImage;
  if (!primaryImage) {
    return NextResponse.json(
      { error: "Document payload missing: 'image' or 'frontImage' data URL is required.", code: "MISSING_IMAGE" },
      { status: 400 }
    );
  }

  const primaryValidation = validateImagePayload(primaryImage);
  if (primaryValidation.error) {
    return NextResponse.json(
      { error: primaryValidation.error, code: "BAD_REQUEST" },
      { status: primaryValidation.status || 400 }
    );
  }

  if (backImage) {
    const backValidation = validateImagePayload(backImage);
    if (backValidation.error) {
      return NextResponse.json(
        { error: `Back side: ${backValidation.error}`, code: "BAD_REQUEST" },
        { status: backValidation.status || 400 }
      );
    }
  }

    // 5. Execute OCR Orchestration (Azure Document Intelligence Tier 1 with Mistral Tier 2 fallback)
    const { OcrOrchestrator } = await import("@/lib/ocr/providers/orchestrator");
    const orchestrator = new OcrOrchestrator();

    let combinedText = "";
    let overallConfidence = 0.95;
    let providerName = "azure";
    let modelName = "prebuilt-read";
    let rawLayout: any = undefined;
    let childSectionText: string | undefined = undefined;
    let childNameText: string | undefined = undefined;

    try {
      // 5A. Full Document OCR (Primary)
      if (backImage) {
        const [frontRes, backRes] = await Promise.all([
          orchestrator.execute({
            image: primaryImage,
            extractFields: true,
            gradeLevel: "PSA",
            documentSide: "front",
          }),
          orchestrator.execute({
            image: backImage,
            extractFields: true,
            gradeLevel: "PSA",
            documentSide: "back",
          }),
        ]);

        combinedText = `=== FRONT PAGE ===\n${frontRes.text}\n\n=== BACK / ENDORSEMENT PAGE ===\n${backRes.text}`;
        const confs = [frontRes.confidence, backRes.confidence].filter((c): c is number => typeof c === "number");
        if (confs.length > 0) {
          overallConfidence = confs.reduce((a, b) => a + b, 0) / confs.length;
        }
        providerName = frontRes.provider || "azure";
        modelName = `${frontRes.model}+${backRes.model}`;
        rawLayout = frontRes.rawLayout || backRes.rawLayout;
      } else {
        const ocrRes = await orchestrator.execute({
          image: primaryImage,
          extractFields: true,
          gradeLevel: "PSA",
          documentSide: "front",
        });

        combinedText = ocrRes.text;
        if (typeof ocrRes.confidence === "number") {
          overallConfidence = ocrRes.confidence;
        }
        providerName = ocrRes.provider || "azure";
        modelName = ocrRes.model;
        rawLayout = ocrRes.rawLayout;
      }

      // 5B. Targeted CHILD section crop OCR (Items 1 - 5: Name, Sex, DOB, Place of Birth)
      if (childSectionImage && typeof childSectionImage === "string" && childSectionImage.startsWith("data:image/")) {
        try {
          const sectionRes = await orchestrator.execute({
            image: childSectionImage,
            extractFields: true,
            gradeLevel: "PSA",
            documentSide: "front",
          });
          if (sectionRes && sectionRes.text) {
            childSectionText = sectionRes.text;
          }
        } catch (cropErr) {
          console.warn("[PSA Scan] Targeted child section OCR failed, falling back to full document:", cropErr);
        }
      }

      // 5C. Targeted Item 1 CHILD NAME crop OCR (First, Middle, Last Name only)
      if (childNameImage && typeof childNameImage === "string" && childNameImage.startsWith("data:image/")) {
        try {
          const nameRes = await orchestrator.execute({
            image: childNameImage,
            extractFields: true,
            gradeLevel: "PSA",
            documentSide: "front",
          });
          if (nameRes && nameRes.text) {
            childNameText = nameRes.text;
          }
        } catch (nameErr) {
          console.warn("[PSA Scan] Targeted child name OCR failed, falling back to child section/full document:", nameErr);
        }
      }
    } catch (ocrError: any) {
      console.error("PSA scan OCR orchestration error:", ocrError);
      const status = ocrError?.status || (ocrError?.code === "TIMEOUT" ? 504 : 502);
      return NextResponse.json(
        {
          error: ocrError?.message || "OCR service failed to extract text from PSA document.",
          code: ocrError?.code || "OCR_PROCESSING_FAILED",
          diagnosticCode: ocrError?.diagnosticCode || ocrError?.innerCode || undefined,
          retryAfter: ocrError?.retryAfter,
        },
        { status }
      );
    }

    // 6. Parse PSA fields using authoritative parser with targeted crops
    const parsed = parsePsaBirthCert(combinedText, rawLayout, overallConfidence, {
      childSectionText,
      childNameText,
    });

    const durationMs = Date.now() - startTime;

    // 7. Non-PII audit logging (Safe Test Mode — NEVER exposes child name or PII)
    try {
      await logAuditEvent({
        category: "OCR",
        action: "OCR_PROCESSING_COMPLETED",
        outcome: "SUCCESS",
        targetType: "ocr_job",
        targetLabel: `PSA Test Scan (${providerName})`,
        reason: `PSA OCR test scan completed in ${durationMs}ms`,
        details: {
          provider: providerName,
          model: modelName,
          durationMs,
          documentType: "birth_cert",
          confidence: overallConfidence,
          test_mode: true,
          persisted: false,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    // Return structured extraction result (TEST MODE: strictly in-memory, no DB write)
    return NextResponse.json({
      success: true,
      text: combinedText,
      identity: parsed.identity,
      field_statuses: parsed.field_statuses,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      model: modelName,
      provider: providerName,
      field_recognition: parsed.field_recognition,
      recognition_summary: parsed.recognition_summary,
      child_section_text: childSectionText || undefined,
      child_name_text: childNameText || undefined,
      preprocessed: Boolean(isPreprocessed),
      test_mode: true,
      persisted: false,
    });
  } catch (fatalError: any) {
    console.error("PSA scan fatal route error:", fatalError);
    const status = fatalError?.status || (fatalError?.code === "TIMEOUT" ? 504 : 500);
    return NextResponse.json(
      {
        error: fatalError?.message || "Internal server error occurred while processing PSA document.",
        code: fatalError?.code || "INTERNAL_SERVER_ERROR",
        diagnosticCode: fatalError?.diagnosticCode || fatalError?.innerCode || undefined,
        retryAfter: fatalError?.retryAfter,
      },
      { status }
    );
  }
}

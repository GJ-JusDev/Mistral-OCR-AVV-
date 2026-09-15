import { NextResponse } from "next/server";
import { callMistralOcr } from "@/lib/ocr/mistral";
import { parseOcrText } from "@/lib/ocr/parser";
import { parseGradesText } from "@/lib/ocr/gradesParser";
import type { ExtractedFields } from "@/types/documents";

export type OcrResponse = {
  text: string;
  fields?: ExtractedFields;
  confidence: number;
  model: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Mistral OCR is not configured. Set MISTRAL_API_KEY." },
      { status: 500 }
    );
  }

  try {
    const { image, extractFields } = (await request.json()) as {
      image?: string;
      extractFields?: boolean;
    };

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "A valid base64 image data URL is required." },
        { status: 400 }
      );
    }

    let ocrResult;
    try {
      ocrResult = await callMistralOcr(image, apiKey);
    } catch (error: any) {
      console.error("[ocr] Mistral OCR error", error);
      const message = error.message || "Mistral OCR request failed.";
      // Heuristic: if it mentions a 4xx code, return 400. Otherwise 502 for upstream error.
      const isClientError = /4\d\d/.test(message);
      return NextResponse.json(
        { error: message },
        { status: isClientError ? 400 : 502 }
      );
    }

    const { text } = ocrResult;

    let fields: ExtractedFields | undefined;
    if (extractFields) {
      // parseGradesText automatically detects and parses both student info (front) and grades (back)
      fields = parseGradesText(text);
    }

    const responseData: OcrResponse = {
      text,
      confidence: 1.0,
      model: "mistral-ocr-latest",
    };
    
    if (fields) {
      responseData.fields = fields;
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("[ocr] Internal error processing OCR request:", error);
    return NextResponse.json(
      { error: "Unable to process the OCR request." },
      { status: 400 }
    );
  }
}
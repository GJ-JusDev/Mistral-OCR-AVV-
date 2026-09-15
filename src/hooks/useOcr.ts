"use client";

import { useState, useCallback } from "react";
import type { MistralOcrResult } from "@/lib/ocr/mistral";
import type { ExtractedFields } from "@/types/documents";

export type OcrResponse = {
  text: string;
  fields?: ExtractedFields;
  confidence?: number;
  model?: string;
  error?: string;
};

export function useOcr() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extract = useCallback(async (image: string, extractFields: boolean = false): Promise<OcrResponse> => {
    setIsExtracting(true);
    setError(null);
    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, extractFields }),
      });
      
      const result = await response.json() as OcrResponse;
      
      if (!response.ok) {
        throw new Error(result.error ?? "OCR extraction failed.");
      }
      
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(message);
      throw err;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  return {
    extract,
    isExtracting,
    error,
    setError
  };
}

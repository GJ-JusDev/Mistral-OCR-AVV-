"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ExtractedFields } from "@/types/documents";

export type OcrErrorCode =
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXHAUSTED"
  | "INVALID_API_KEY"
  | "BAD_REQUEST"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "CONCURRENT_REQUEST"
  | "UNKNOWN_ERROR";

export type OcrErrorDetails = {
  message: string;
  code: OcrErrorCode;
  status: number;
  retryAfter?: number;
};

export type OcrResponse = {
  text?: string;
  fields?: ExtractedFields;
  confidence?: number;
  model?: string;
  provider?: string;
  error?: string;
  code?: OcrErrorCode;
  retryAfter?: number;
};

export function useOcr() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<OcrErrorDetails | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [canRetry, setCanRetry] = useState(true);

  const inFlightRef = useRef(false);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRequestRef = useRef<{
    image: string;
    extractFields: boolean;
    gradeLevel: string;
    documentType?: string;
  } | null>(null);

  // Clean up any countdown timer on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const clearError = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setError(null);
    setErrorDetails(null);
    setRetryAfter(null);
    setCanRetry(true);
  }, []);

  const extract = useCallback(
    async (
      image: string,
      extractFields: boolean = false,
      gradeLevel: string = "Senior High School",
      documentType?: string
    ): Promise<OcrResponse> => {
      // Guard against concurrent duplicate requests
      if (inFlightRef.current) {
        console.warn("[useOcr] Extraction already in progress; ignoring duplicate trigger.");
        const duplicateError = new Error("An OCR extraction is already in progress. Please wait.");
        const details: OcrErrorDetails = {
          message: "An OCR extraction is already in progress. Please wait.",
          code: "CONCURRENT_REQUEST",
          status: 409,
        };
        (duplicateError as any).errorDetails = details;
        throw duplicateError;
      }

      // Clear any prior countdown timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }

      lastRequestRef.current = { image, extractFields, gradeLevel, documentType };
      inFlightRef.current = true;
      setIsExtracting(true);
      setError(null);
      setErrorDetails(null);
      setRetryAfter(null);
      setCanRetry(false);

      try {
        const response = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, extractFields, gradeLevel, documentType }),
        });

        let result: OcrResponse;
        try {
          result = (await response.json()) as OcrResponse;
        } catch {
          result = {
            error: `OCR service responded with status ${response.status}`,
            code: "UPSTREAM_ERROR",
          };
        }

        if (!response.ok) {
          const status = response.status;
          const retryHeader = response.headers.get("Retry-After");
          const parsedHeaderRetry = retryHeader ? parseInt(retryHeader, 10) : undefined;
          const waitSeconds = result.retryAfter ?? parsedHeaderRetry;

          let code: OcrErrorCode = "UNKNOWN_ERROR";
          if (result.code && [
            "RATE_LIMIT_EXCEEDED",
            "QUOTA_EXHAUSTED",
            "INVALID_API_KEY",
            "BAD_REQUEST",
            "UPSTREAM_ERROR"
          ].includes(result.code)) {
            code = result.code as OcrErrorCode;
          } else if (status === 429) {
            code = "RATE_LIMIT_EXCEEDED";
          } else if (status === 400) {
            code = "BAD_REQUEST";
          } else if (status === 401 || status === 403) {
            code = "INVALID_API_KEY";
          } else if (status >= 500) {
            code = "UPSTREAM_ERROR";
          }

          let displayMessage = result.error ?? "OCR extraction failed.";
          if (code === "RATE_LIMIT_EXCEEDED") {
            displayMessage =
              "OCR requests are temporarily limited by the provider. Please wait a moment before trying again.";
          } else if (code === "QUOTA_EXHAUSTED") {
            displayMessage =
              "OCR provider account quota or credit limit exhausted. Please contact your system administrator to check the Mistral API plan.";
          }

          const details: OcrErrorDetails = {
            message: displayMessage,
            code,
            status,
            retryAfter: waitSeconds,
          };

          setError(displayMessage);
          setErrorDetails(details);

          // If rate limited, initiate active cooldown countdown
          if (code === "RATE_LIMIT_EXCEEDED") {
            const cooldown = typeof waitSeconds === "number" && waitSeconds > 0 ? waitSeconds : 5;
            setRetryAfter(cooldown);
            setCanRetry(false);

            let remaining = cooldown;
            countdownTimerRef.current = setInterval(() => {
              remaining -= 1;
              if (remaining <= 0) {
                if (countdownTimerRef.current) {
                  clearInterval(countdownTimerRef.current);
                  countdownTimerRef.current = null;
                }
                setRetryAfter(0);
                setCanRetry(true);
              } else {
                setRetryAfter(remaining);
              }
            }, 1000);
          } else if (code === "QUOTA_EXHAUSTED") {
            // Quota exhaustion cannot be resolved by immediate countdown
            setCanRetry(false);
          } else {
            // Other errors allow retry immediately
            setCanRetry(true);
          }

          const errorObj = new Error(displayMessage);
          (errorObj as any).errorDetails = details;
          throw errorObj;
        }

        setCanRetry(true);
        return result;
      } catch (err: any) {
        if (!errorDetails) {
          const message = err instanceof Error ? err.message : "An unexpected error occurred.";
          setError(message);
        }
        throw err;
      } finally {
        inFlightRef.current = false;
        setIsExtracting(false);
      }
    },
    [errorDetails]
  );

  const retry = useCallback(async (): Promise<OcrResponse | null> => {
    if (!lastRequestRef.current) return null;
    return extract(
      lastRequestRef.current.image,
      lastRequestRef.current.extractFields,
      lastRequestRef.current.gradeLevel,
      lastRequestRef.current.documentType
    );
  }, [extract]);

  const extractTwoSided = useCallback(
    async (
      frontImage: string,
      backImage: string,
      extractFields: boolean = true,
      gradeLevel: string = "Senior High School"
    ): Promise<OcrResponse> => {
      if (inFlightRef.current) {
        console.warn("[useOcr] Extraction already in progress; ignoring duplicate trigger.");
        const duplicateError = new Error("An OCR extraction is already in progress. Please wait.");
        const details: OcrErrorDetails = {
          message: "An OCR extraction is already in progress. Please wait.",
          code: "CONCURRENT_REQUEST",
          status: 409,
        };
        (duplicateError as any).errorDetails = details;
        throw duplicateError;
      }

      inFlightRef.current = true;
      setIsExtracting(true);
      setError(null);
      setErrorDetails(null);
      setRetryAfter(null);
      setCanRetry(false);

      try {
        const response = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frontImage,
            backImage,
            extractFields,
            gradeLevel,
            documentType: "sf9",
          }),
        });

        let result: OcrResponse;
        try {
          result = (await response.json()) as OcrResponse;
        } catch {
          result = {
            error: `OCR service responded with status ${response.status}`,
            code: "UPSTREAM_ERROR",
          };
        }

        if (!response.ok) {
          const displayMessage = result.error ?? "Two-sided OCR extraction failed.";
          const details: OcrErrorDetails = {
            message: displayMessage,
            code: (result.code as OcrErrorCode) || "UPSTREAM_ERROR",
            status: response.status,
            retryAfter: result.retryAfter,
          };
          setError(displayMessage);
          setErrorDetails(details);
          const errorObj = new Error(displayMessage);
          (errorObj as any).errorDetails = details;
          throw errorObj;
        }

        setCanRetry(true);
        return result;
      } catch (err: any) {
        if (!errorDetails) {
          const message = err instanceof Error ? err.message : "An unexpected error occurred.";
          setError(message);
        }
        throw err;
      } finally {
        inFlightRef.current = false;
        setIsExtracting(false);
      }
    },
    [errorDetails]
  );

  return {
    extract,
    extractTwoSided,
    retry,
    isExtracting,
    error,
    errorDetails,
    retryAfter,
    canRetry,
    clearError,
    setError,
  };
}


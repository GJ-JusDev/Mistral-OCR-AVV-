/**
 * Safe API Response Parser
 *
 * Robustly parses fetch Response objects from OCR and API endpoints.
 * Defends against:
 * 1. Empty response bodies (prevents "Unexpected end of JSON input" error)
 * 2. HTML gateway error pages (502 Bad Gateway, 504 Gateway Timeout from Vercel / Nginx / Cloudflare)
 * 3. Plain-text server errors
 * 4. Malformed JSON payloads
 */

export interface SafeApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  code?: string;
  diagnosticCode?: string;
  retryAfter?: number;
}

export async function parseApiResponseSafely<T = any>(
  res: Response,
  options?: { defaultErrorMessage?: string }
): Promise<SafeApiResponse<T>> {
  const status = res.status;
  const contentType = (res.headers?.get("content-type") || "").toLowerCase();
  const defaultMsg = options?.defaultErrorMessage || "Scan request failed. Please try again.";

  let rawText = "";
  try {
    rawText = await res.text();
  } catch (readErr: any) {
    return {
      ok: false,
      status,
      data: null,
      error: `Network error: Unable to read server response (${readErr?.message || "connection closed"}).`,
      code: "NETWORK_READ_ERROR",
    };
  }

  const trimmed = (rawText || "").trim();

  // 1. Handle empty response body
  if (!trimmed) {
    let emptyMsg = `The server returned an empty response (HTTP ${status}).`;
    let emptyCode = "EMPTY_RESPONSE";

    if (status === 504 || status === 408) {
      emptyMsg = "The scan request timed out. The server took too long to process the document.";
      emptyCode = "TIMEOUT";
    } else if (status === 502) {
      emptyMsg = "Bad Gateway: The OCR service or server is temporarily unavailable.";
      emptyCode = "BAD_GATEWAY";
    } else if (status === 413) {
      emptyMsg = "The document payload exceeds the maximum upload limit.";
      emptyCode = "PAYLOAD_TOO_LARGE";
    } else if (status >= 500) {
      emptyMsg = `Server error (${status}): The server returned an empty response. Please try again.`;
    }

    return {
      ok: false,
      status,
      data: null,
      error: emptyMsg,
      code: emptyCode,
    };
  }

  // 2. Handle JSON response
  let parsedJson: any = null;
  const looksLikeJson =
    contentType.includes("application/json") ||
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));

  if (looksLikeJson) {
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      parsedJson = null;
    }
  }

  if (parsedJson !== null && typeof parsedJson === "object") {
    if (!res.ok) {
      return {
        ok: false,
        status,
        data: parsedJson,
        error: parsedJson.error || `Scan failed with status ${status}.`,
        code: parsedJson.code || "API_ERROR",
        diagnosticCode: parsedJson.diagnosticCode || parsedJson.innerCode,
        retryAfter: parsedJson.retryAfter,
      };
    }

    return {
      ok: true,
      status,
      data: parsedJson as T,
    };
  }

  // 3. Handle Non-JSON response (HTML error page, plain text, proxy errors)
  let cleanMsg = trimmed;

  if (trimmed.startsWith("<") || contentType.includes("text/html")) {
    // Strip HTML tags safely
    cleanMsg = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (cleanMsg.length > 200) {
      cleanMsg = cleanMsg.slice(0, 200) + "...";
    }
  }

  if (!res.ok) {
    let failureMsg = cleanMsg;
    let failureCode = "NON_JSON_RESPONSE";

    if (status === 504) {
      failureMsg = "The OCR scanning request timed out. Please try again with a clearer or smaller image.";
      failureCode = "TIMEOUT";
    } else if (status === 502) {
      failureMsg = "Bad Gateway: The OCR service or server is temporarily unavailable.";
      failureCode = "BAD_GATEWAY";
    } else if (status === 413) {
      failureMsg = "The document payload exceeds the maximum upload limit.";
      failureCode = "PAYLOAD_TOO_LARGE";
    } else if (!failureMsg) {
      failureMsg = `Server error (${status}): ${defaultMsg}`;
    } else {
      failureMsg = `Server error (${status}): ${failureMsg}`;
    }

    return {
      ok: false,
      status,
      data: null,
      error: failureMsg,
      code: failureCode,
    };
  }

  return {
    ok: false,
    status,
    data: null,
    error: `Unexpected server response format (HTTP ${status}). Expected JSON.`,
    code: "UNEXPECTED_FORMAT",
  };
}

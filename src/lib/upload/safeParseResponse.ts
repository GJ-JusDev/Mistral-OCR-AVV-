/**
 * Safe JSON response parser that checks Content-Type and handles non-JSON / HTML
 * (such as <!DOCTYPE html> 404 or 500 pages) cleanly without throwing:
 * "Unexpected token '<', "<!DOCTYPE "... is not valid JSON".
 */
export async function safeParseJsonResponse<T = any>(
  res: Response,
  fallbackValue: any = null
): Promise<{ ok: boolean; data: T; error?: string }> {
  try {
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const rawText = await res.text();
    const trimmed = rawText.trim();

    if (contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          ok: res.ok,
          data: parsed,
          error: res.ok ? undefined : (typeof parsed?.error === "string" ? parsed.error : `HTTP ${res.status}`),
        };
      } catch (parseErr: any) {
        console.warn(`[safeParseJsonResponse] Failed to parse JSON body: ${trimmed.slice(0, 100)}`, parseErr);
        return {
          ok: false,
          data: fallbackValue,
          error: `Malformed JSON response (HTTP ${res.status})`,
        };
      }
    }

    console.warn(
      `[safeParseJsonResponse] Expected JSON but received non-JSON (${contentType || "unknown"} HTTP ${res.status}): ${trimmed.slice(0, 100)}`
    );
    return {
      ok: false,
      data: fallbackValue,
      error: `Server returned non-JSON response (HTTP ${res.status})`,
    };
  } catch (err: any) {
    console.warn("[safeParseJsonResponse] Network/response reading exception:", err);
    return {
      ok: false,
      data: fallbackValue,
      error: err?.message || "Failed to read server response",
    };
  }
}

/**
 * Serializes a JavaScript value to JSON string, safely preventing circular structure
 * crashes ("TypeError: Converting circular structure to JSON") and stripping recursive
 * pointers (such as reconciledDossier, previousDossier, or DOM / React internal keys).
 */
export function safeJsonStringify(payload: unknown, space?: number | string): string {
  const seen = new WeakSet();
  return JSON.stringify(
    payload,
    (key, value) => {
      // Strip recursive circular keys
      if (key === "reconciledDossier" || key === "previousDossier") {
        if (value && typeof value === "object") {
          if (seen.has(value)) return undefined;
          seen.add(value);
          const copy = { ...(value as Record<string, unknown>) };
          delete copy.reconciledDossier;
          delete copy.previousDossier;
          return copy;
        }
      }
      // Strip React / DOM internals if accidentally passed
      if (key.startsWith("_react") || key.startsWith("$$typeof") || key === "_owner") {
        return undefined;
      }
      if (value !== null && typeof value === "object") {
        if (typeof (value as any).nodeType === "number") return undefined;
        if (seen.has(value)) {
          return undefined; // Break cycle
        }
        seen.add(value);
      }
      return value;
    },
    space
  );
}

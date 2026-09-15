/**
 * Mistral OCR client — wraps the Mistral OCR API for server-side use.
 */

type MistralOcrPage = {
  markdown?: string;
};

type MistralOcrResponse = {
  pages?: MistralOcrPage[];
  error?: { message?: string };
  message?: string;
};

export type MistralOcrResult = {
  /** Raw markdown text from all pages concatenated. */
  text: string;
  /** Number of pages in the response. */
  pageCount: number;
};

/**
 * Call the Mistral OCR API with a base64-encoded image.
 *
 * @param imageDataUrl  Full data URL (e.g., "data:image/png;base64,...")
 * @param apiKey        Mistral API key
 * @returns Extracted text and page count.
 * @throws Error if the API call fails or returns an error.
 */
export async function callMistralOcr(
  imageDataUrl: string,
  apiKey: string
): Promise<MistralOcrResult> {
  if (!apiKey) {
    throw new Error("Mistral OCR is not configured. Set MISTRAL_API_KEY.");
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    throw new Error("A valid base64 image data URL is required.");
  }

  const response = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mistral-ocr-latest",
      document: { type: "image_url", image_url: imageDataUrl },
    }),
  });

  const result = (await response.json()) as MistralOcrResponse;

  if (!response.ok) {
    const message =
      result.error?.message ??
      result.message ??
      `Mistral OCR request failed (${response.status}).`;
    throw new Error(message);
  }

  const pages = result.pages ?? [];
  const text = pages.map((page) => page.markdown ?? "").join("\n\n");

  return {
    text,
    pageCount: pages.length,
  };
}

import { redactSecrets } from "@/lib/server/redaction";

type CreateOpenAiResponseOptions = {
  apiKey: string;
  payload: unknown;
};

type OpenAiResponseResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; body: unknown };

export function getOpenAiKeyFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const apiKey = match?.[1]?.trim();

  return apiKey ? apiKey : null;
}

export async function createOpenAiResponse({
  apiKey,
  payload,
}: CreateOpenAiResponseOptions): Promise<OpenAiResponseResult> {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      console.warn("OpenAI Responses API request failed", {
        status: response.status,
        body: redactSecrets(body),
      });
      return { ok: false, status: response.status, body };
    }

    return { ok: true, body };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      body: error instanceof Error ? error.message : error,
    };
  }
}

export function extractOutputText(responseBody: unknown) {
  if (!isRecord(responseBody)) {
    return null;
  }

  if (typeof responseBody.output_text === "string" && responseBody.output_text.length > 0) {
    return responseBody.output_text;
  }

  if (Array.isArray(responseBody.output_text)) {
    const outputText = responseBody.output_text.filter((item) => typeof item === "string");

    if (outputText.length > 0) {
      return outputText.join("\n");
    }
  }

  if (!Array.isArray(responseBody.output)) {
    return null;
  }

  const chunks = responseBody.output.flatMap((outputItem) => {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      return [];
    }

    return outputItem.content.flatMap((contentItem) => {
      if (!isRecord(contentItem)) {
        return [];
      }

      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        return [contentItem.text];
      }

      if (typeof contentItem.output_text === "string") {
        return [contentItem.output_text];
      }

      return [];
    });
  });

  return chunks.length > 0 ? chunks.join("\n") : null;
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

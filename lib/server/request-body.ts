export class RequestBodyTooLargeError extends Error {}

export async function readJsonRequestBody(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readRequestBodyText(request, maxBytes));
}

async function readRequestBodyText(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();

  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytesRead += value.byteLength;

    if (bytesRead > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }

    body += decoder.decode(value, { stream: true });
  }

  return body + decoder.decode();
}

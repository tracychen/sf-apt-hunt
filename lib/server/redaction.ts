const openAiKeyPattern = /sk-[A-Za-z0-9_-]+/g;
const googleApiKeyPattern = /AIza[A-Za-z0-9_-]+/g;
const apiKeyQueryParamPattern = /([?&](?:api_key|key)=)[^&#\s]+/gi;
const secretFieldPattern =
  /^(apiKey|api_key|x-api-key|authorization|openAiKey|openaiKey|token|secret|googleMapsApiKey|google_maps_api_key)$/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(apiKeyQueryParamPattern, "$1[REDACTED]")
      .replace(openAiKeyPattern, "[REDACTED]")
      .replace(googleApiKeyPattern, "[REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      secretFieldPattern.test(key) ? "[REDACTED]" : redactSecrets(entryValue),
    ]),
  );
}

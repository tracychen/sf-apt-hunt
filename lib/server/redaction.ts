const openAiKeyPattern = /sk-[A-Za-z0-9_-]+/g;
const secretFieldPattern = /^(apiKey|authorization|openAiKey|openaiKey|token|secret)$/i;

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(openAiKeyPattern, "[REDACTED]");
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

export function canonicalizeGeocodeQuery(query: string) {
  const canonical = query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*)+/g, ", ")
    .replace(/^,\s*|\s*,\s*$/g, "")
    .trim();

  const baseQuery = canonical
    .replace(/(?:^|,\s*|\s+)san francisco(?:\s*,?\s*ca)?$/i, "")
    .replace(/^,\s*|\s*,\s*$/g, "")
    .trim();

  if (baseQuery !== canonical) {
    return baseQuery.length > 0 ? `${baseQuery}, san francisco ca` : "san francisco ca";
  }

  return canonical.length > 0 ? `${canonical}, san francisco ca` : "san francisco ca";
}

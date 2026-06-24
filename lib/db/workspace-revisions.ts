export function createRevision(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

import { createHash, timingSafeEqual } from "node:crypto";

export async function hashInstallationSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export async function verifyInstallationSecret(secret: string, expectedHash: string) {
  const actualHash = await hashInstallationSecret(secret);
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

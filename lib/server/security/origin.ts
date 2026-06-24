import "server-only";

export class ForbiddenOriginError extends Error {
  constructor() {
    super("Forbidden origin.");
  }
}

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const allowedOrigin = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;

  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ForbiddenOriginError();
  }

  if (origin && origin !== allowedOrigin) {
    throw new ForbiddenOriginError();
  }
}

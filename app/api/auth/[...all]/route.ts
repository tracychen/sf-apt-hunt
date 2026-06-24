import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/server/auth/config";

function getAuthRouteHandler() {
  return toNextJsHandler(getAuth());
}

export async function GET(request: Request) {
  return getAuthRouteHandler().GET(request);
}

export async function POST(request: Request) {
  return getAuthRouteHandler().POST(request);
}

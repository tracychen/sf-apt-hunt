import { revokeExtensionBearer } from "@/lib/server/extension/connections";

export async function DELETE(request: Request) {
  const token = readBearerToken(request);
  const extensionId = request.headers.get("x-sf-apt-extension-id")?.trim() ?? "";

  if (!token || !extensionId) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const result = await revokeExtensionBearer({ token, extensionId });
  return Response.json(result, { status: result.ok ? 200 : result.error === "token_expired" ? 401 : 403 });
}

function readBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
}

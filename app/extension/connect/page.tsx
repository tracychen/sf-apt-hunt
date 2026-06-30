import { redirect } from "next/navigation";

import { extensionIdSchema } from "@/lib/domain/schemas";
import { getCurrentUser } from "@/lib/server/auth/session";
import { isAllowedExtensionId } from "@/lib/server/extension/connections";
import { getOrCreateDefaultWorkspace } from "@/lib/server/workspaces";

import { ExtensionConnectClient } from "./extension-connect-client";

export default async function ExtensionConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ extensionId?: string }>;
}) {
  const params = await searchParams;
  const extensionId = params.extensionId ?? "";
  const user = await getCurrentUser();

  if (!user) {
    redirect(
      `/api/auth/sign-in/google?callbackURL=${encodeURIComponent(
        `/extension/connect?extensionId=${extensionId}`,
      )}`,
    );
  }

  const parsed = extensionIdSchema.safeParse(extensionId);
  const allowed = parsed.success && isAllowedExtensionId(parsed.data);
  const { workspace } = await getOrCreateDefaultWorkspace(user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <p className="text-xs uppercase text-muted-foreground">Apt Hunt extension</p>
      <h1 className="text-2xl font-semibold">Connect browser extension</h1>
      {allowed ? (
        <ExtensionConnectClient
          accountEmail={user.email}
          extensionId={parsed.data}
          workspaceName={workspace.name}
        />
      ) : (
        <p className="border border-border bg-card p-4 text-sm">
          This extension is not recognized for this Apt Hunt environment.
        </p>
      )}
    </main>
  );
}

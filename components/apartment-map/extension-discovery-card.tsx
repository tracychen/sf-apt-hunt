import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { getValidChromeExtensionUrl } from "@/lib/extension/chrome-store-url";

export function ExtensionDiscoveryCard({
  ownershipMode,
  chromeExtensionUrl = process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL,
}: {
  ownershipMode: "local" | "workspace";
  chromeExtensionUrl?: string | null;
}) {
  const isWorkspaceMode = ownershipMode === "workspace";
  const validChromeExtensionUrl = getValidChromeExtensionUrl(chromeExtensionUrl);

  return (
    <section
      className="border border-sidebar-border bg-background p-3 text-sm"
      data-testid="extension-discovery-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Import tool</p>
          <h2 className="mt-1 font-medium">Facebook saver extension</h2>
        </div>
        <span className="border border-sidebar-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          Chrome
        </span>
      </div>

      {isWorkspaceMode ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Save reviewed Facebook housing posts into this workspace.
          </p>
          {validChromeExtensionUrl ? (
            <a
              className="mt-3 block border border-sidebar-border px-3 py-2 text-center text-xs font-medium"
              href={validChromeExtensionUrl}
              rel="noreferrer"
              target="_blank"
            >
              Install Chrome Extension
            </a>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Chrome Web Store install is not ready for public install yet.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            After installing, open the extension popup and choose Connect Apt Hunt.
          </p>
          <details className="mt-3 border border-sidebar-border bg-muted/30 p-2">
            <summary className="cursor-pointer text-xs font-medium">Developer setup</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>
                Open <code className="text-foreground">chrome://extensions</code> and Load unpacked from{" "}
                <code className="text-foreground">extension/</code>.
              </li>
              <li>
                Copy the extension id into{" "}
                <code className="text-foreground">EXTENSION_ALLOWED_IDS</code>.
              </li>
              <li>Restart the app, then connect from the extension popup.</li>
              <li>Add Facebook groups to the extension allowlist.</li>
            </ol>
          </details>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            Sign in to sync Facebook saves across devices.
          </p>
          <GoogleSignInButton className="mt-3 w-full" size="sm">
            Sign in to use extension
          </GoogleSignInButton>
        </>
      )}
    </section>
  );
}

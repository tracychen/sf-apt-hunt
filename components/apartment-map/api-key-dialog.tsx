"use client";

import { Button } from "@/components/ui/button";

export function ApiKeyDialog({
  apiKey,
  remembered,
  onApiKeyChange,
}: {
  apiKey: string | null;
  remembered: boolean;
  onApiKeyChange: (key: string | null, remembered: boolean) => void;
}) {
  const hasApiKey = Boolean(apiKey);

  return (
    <section className="border border-sidebar-border bg-background p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{hasApiKey ? "OpenAI key saved" : "OpenAI key required"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasApiKey
              ? remembered
                ? "Remembered on this device."
                : "Stored for this browser session."
              : "Assistant and listing search controls are disabled in this demo shell."}
          </p>
        </div>
        <span className="border border-border px-2 py-1 text-[10px] uppercase text-muted-foreground">
          {hasApiKey ? "Ready" : "Demo"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!hasApiKey} variant="outline" onClick={() => onApiKeyChange(null, false)}>
          Clear key
        </Button>
        <Button disabled variant="outline">
          Add key
        </Button>
      </div>
    </section>
  );
}

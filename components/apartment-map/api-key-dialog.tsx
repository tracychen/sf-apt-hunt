"use client";

import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { clearStoredOpenAiKey, saveOpenAiKey } from "@/lib/storage/api-key-storage";

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
  const [draftKey, setDraftKey] = useState("");
  const [rememberOnDevice, setRememberOnDevice] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextKey = draftKey.trim();
    if (!nextKey) {
      return;
    }

    saveOpenAiKey(nextKey, rememberOnDevice);
    onApiKeyChange(nextKey, rememberOnDevice);
    setDraftKey("");
    setRememberOnDevice(false);
    setIsEditing(false);
  }

  function handleClearKey() {
    clearStoredOpenAiKey();
    onApiKeyChange(null, false);
    setDraftKey("");
    setRememberOnDevice(false);
    setIsEditing(false);
  }

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
              : "AI requests are disabled until you save an OpenAI key."}
          </p>
        </div>
        <span className="border border-border px-2 py-1 text-[10px] uppercase text-muted-foreground">
          {hasApiKey ? "Ready" : "No key"}
        </span>
      </div>

      {isEditing ? (
        <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-xs font-medium" htmlFor="openai-api-key">
            OpenAI API key
          </label>
          <input
            id="openai-api-key"
            className="w-full border border-input bg-background px-2 py-1.5 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring/50"
            autoComplete="off"
            type="password"
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              className="size-3.5"
              type="checkbox"
              checked={rememberOnDevice}
              onChange={(event) => setRememberOnDevice(event.target.checked)}
            />
            Remember on this device
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={draftKey.trim().length === 0} type="submit">
              Save key
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!hasApiKey} variant="outline" onClick={handleClearKey}>
          Clear key
        </Button>
        <Button type="button" variant="outline" onClick={() => setIsEditing(true)}>
          {hasApiKey ? "Replace OpenAI key" : "Add OpenAI key"}
        </Button>
      </div>
    </section>
  );
}

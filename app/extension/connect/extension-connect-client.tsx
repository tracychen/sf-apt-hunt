"use client";

import { useState } from "react";

type ExtensionConnectClientProps = {
  accountEmail: string;
  extensionId: string;
  workspaceName: string;
};

type ChromeRuntime = {
  sendMessage: (extensionId: string, message: unknown, callback?: () => void) => void;
  lastError?: {
    message?: string;
  };
};

type ChromeApi = {
  runtime: ChromeRuntime;
};

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

declare global {
  interface Window {
    chrome?: unknown;
  }
}

export function ExtensionConnectClient({
  accountEmail,
  extensionId,
  workspaceName,
}: ExtensionConnectClientProps) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [message, setMessage] = useState("");

  async function connectExtension() {
    setStatus("connecting");
    setMessage("");

    try {
      const response = await fetch("/api/extension/connections", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ extensionId }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        setStatus("error");
        setMessage("Connection request was rejected.");
        return;
      }

      await sendExtensionMessage(extensionId, body);
      setStatus("connected");
      setMessage("Extension connected.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Extension connection failed.");
    }
  }

  return (
    <section className="flex flex-col gap-4 border border-border bg-card p-4 text-sm">
      <div className="space-y-1">
        <p className="font-medium">{accountEmail}</p>
        <p className="text-muted-foreground">{workspaceName}</p>
      </div>
      <button
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        disabled={status === "connecting" || status === "connected"}
        type="button"
        onClick={connectExtension}
      >
        {status === "connecting" ? "Connecting..." : status === "connected" ? "Connected" : "Connect"}
      </button>
      {message ? (
        <p className={status === "error" ? "text-destructive" : "text-muted-foreground"}>
          {message}
        </p>
      ) : null}
    </section>
  );
}

function sendExtensionMessage(extensionId: string, message: unknown) {
  const chromeRuntime = readChromeRuntime();

  if (!chromeRuntime) {
    return Promise.reject(new Error("Browser extension runtime is unavailable."));
  }

  return new Promise<void>((resolve, reject) => {
    chromeRuntime.sendMessage(extensionId, message, () => {
      const runtimeError = chromeRuntime.lastError?.message;

      if (runtimeError) {
        reject(new Error(runtimeError));
        return;
      }

      resolve();
    });
  });
}

function readChromeRuntime() {
  const chromeApi = window.chrome;

  if (!isChromeApi(chromeApi)) {
    return null;
  }

  return chromeApi.runtime;
}

function isChromeApi(value: unknown): value is ChromeApi {
  if (!value || typeof value !== "object" || !("runtime" in value)) {
    return false;
  }

  const runtime = value.runtime;
  if (!runtime || typeof runtime !== "object" || !("sendMessage" in runtime)) {
    return false;
  }

  return typeof runtime.sendMessage === "function";
}

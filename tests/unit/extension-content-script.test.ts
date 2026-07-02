import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test, vi } from "vitest";
import { JSDOM } from "jsdom";

const groupContextScript = readFileSync(
  fileURLToPath(new URL("../../extension/group-context.js", import.meta.url)),
  "utf8",
);
const captureScript = readFileSync(
  fileURLToPath(new URL("../../extension/capture.js", import.meta.url)),
  "utf8",
);
const contentScript = readFileSync(
  fileURLToPath(new URL("../../extension/content-script.js", import.meta.url)),
  "utf8",
);
const reviewerFixturePage = readFileSync(
  fileURLToPath(new URL("../../app/extension/reviewer-fixture/page.tsx", import.meta.url)),
  "utf8",
);

type AllowlistedGroup = {
  id: string;
};

type ExtensionMessage = {
  type?: string;
  capture?: unknown;
};

describe("Facebook content script", () => {
  test("hosted reviewer fixture contains the visible attribution and post links needed by the content script", () => {
    expect(reviewerFixturePage).toContain("<article");
    expect(reviewerFixturePage).toContain("https://www.facebook.com/groups/apt-hunt-reviewer-fixture");
    expect(reviewerFixturePage).toContain(
      "https://www.facebook.com/groups/apt-hunt-reviewer-fixture/posts/reviewer-listing-1",
    );
  });

  test("injects a save button on the hosted reviewer fixture and captures its listing text", async () => {
    const { document, messages, window } = await loadContentScript(
      [
        `<article id="reviewer-fixture">`,
        `<a href="https://www.facebook.com/groups/apt-hunt-reviewer-fixture">Apt Hunt Reviewer Housing</a>`,
        `<a href="https://www.facebook.com/groups/apt-hunt-reviewer-fixture/posts/reviewer-listing-1">View listing post</a>`,
        `<p>Sunny one-bedroom apartment near Duboce Park. $2,750/month with laundry in building.</p>`,
        `</article>`,
      ].join(""),
      "https://hunt.apartments/extension/reviewer-fixture",
      [{ id: "apt-hunt-reviewer-fixture" }],
    );
    const button = document.querySelector("#reviewer-fixture .apt-hunt-save-button");

    expect(button).not.toBeNull();

    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    const reviewMessages = messages.filter(
      (message) => message.type === "apt-hunt-review-capture",
    );

    expect(reviewMessages.at(-1)?.capture).toMatchObject({
      sourceGroupId: "apt-hunt-reviewer-fixture",
      sourceGroupName: "Apt Hunt Reviewer Housing",
      sourceGroupUrl: "https://www.facebook.com/groups/apt-hunt-reviewer-fixture",
      sourcePostUrl:
        "https://www.facebook.com/groups/apt-hunt-reviewer-fixture/posts/reviewer-listing-1",
      capturedText: expect.stringContaining("Sunny one-bedroom apartment near Duboce Park"),
    });
  });

  test("injects save buttons on the home feed only for posts with local visible allowlisted group attribution", async () => {
    const { document } = await loadContentScript(
      [
        `<style>.ghost-hidden { display: none; }</style>`,
        `<nav>`,
        `<a href="https://www.facebook.com/groups/12345">Allowlisted group elsewhere</a>`,
        `</nav>`,
        `<article id="unrelated-post">`,
        `<p>Unrelated post without group attribution.</p>`,
        `</article>`,
        `<article id="permalink-only-post">`,
        `<p>Post with a permalink but no visible group attribution.</p>`,
        `<a href="https://www.facebook.com/groups/12345/posts/67890">3h</a>`,
        `</article>`,
        `<article id="icon-only-post">`,
        `<p>Post with an empty group anchor.</p>`,
        `<a href="https://www.facebook.com/groups/12345"><span aria-hidden="true"></span></a>`,
        `</article>`,
        `<article id="hidden-text-post">`,
        `<p>Post with hidden attribution only.</p>`,
        `<a href="https://www.facebook.com/groups/12345"><span class="sr-only">SF Housing</span></a>`,
        `</article>`,
        `<article id="stylesheet-hidden-text-post">`,
        `<p>Post with stylesheet-hidden attribution only.</p>`,
        `<a href="https://www.facebook.com/groups/12345"><span class="ghost-hidden">SF Housing</span></a>`,
        `</article>`,
        `<article id="mixed-visibility-post">`,
        `<p>Post with both hidden and visible attribution text.</p>`,
        `<a href="https://www.facebook.com/groups/12345">`,
        `<span class="visually-hidden">Hidden prefix</span>`,
        `<span>SF Housing</span>`,
        `<span style="visibility:hidden">Hidden suffix</span>`,
        `</a>`,
        `</article>`,
        `<article id="allowlisted-post">`,
        `<p>Post with local visible group attribution.</p>`,
        `<a href="https://www.facebook.com/groups/12345">SF Housing</a>`,
        `</article>`,
      ].join(""),
      "https://www.facebook.com/",
      [{ id: "12345" }],
    );

    expect(
      document.querySelector("#unrelated-post .apt-hunt-save-button"),
    ).toBeNull();
    expect(
      document.querySelector("#permalink-only-post .apt-hunt-save-button"),
    ).toBeNull();
    expect(
      document.querySelector("#icon-only-post .apt-hunt-save-button"),
    ).toBeNull();
    expect(
      document.querySelector("#hidden-text-post .apt-hunt-save-button"),
    ).toBeNull();
    expect(
      document.querySelector("#stylesheet-hidden-text-post .apt-hunt-save-button"),
    ).toBeNull();
    expect(
      document.querySelector("#mixed-visibility-post .apt-hunt-save-button"),
    ).not.toBeNull();
    expect(
      document.querySelector("#allowlisted-post .apt-hunt-save-button"),
    ).not.toBeNull();
  });

  test("captures the latest group-page heading when the button is clicked after late page updates", async () => {
    const { document, messages, window } = await loadContentScript(
      [
        `<article id="group-post">`,
        `<p>Sunny studio near Alamo Square.</p>`,
        `<a href="https://www.facebook.com/groups/12345/posts/67890">Permalink</a>`,
        `</article>`,
      ].join(""),
      "https://www.facebook.com/groups/12345",
      [{ id: "12345" }],
    );
    const button = document.querySelector("#group-post .apt-hunt-save-button");

    expect(button).not.toBeNull();

    const heading = document.createElement("h1");
    heading.textContent = "Sunset Rentals";
    document.body.prepend(heading);
    await flush();

    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await flush();

    const reviewMessages = messages.filter(
      (message) => message.type === "apt-hunt-review-capture",
    );

    expect(reviewMessages.at(-1)?.capture).toMatchObject({
      sourceGroupId: "12345",
      sourceGroupName: "Sunset Rentals",
      sourceGroupUrl: "https://www.facebook.com/groups/12345",
    });
  });
});

async function loadContentScript(
  html: string,
  url: string,
  groups: AllowlistedGroup[],
) {
  const dom = new JSDOM(`<body>${html}</body>`, {
    runScripts: "outside-only",
    url,
  });
  const messages: ExtensionMessage[] = [];
  const sendMessage = vi.fn(async (message: ExtensionMessage) => {
    messages.push(message);

    if (message?.type === "apt-hunt-get-allowlist") {
      return { groups };
    }

    return null;
  });

  dom.window.chrome = {
    runtime: {
      sendMessage,
    },
  };

  dom.window.eval(groupContextScript);
  dom.window.eval(captureScript);
  dom.window.eval(contentScript);
  await flush();

  return {
    document: dom.window.document,
    messages,
    sendMessage,
    window: dom.window,
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

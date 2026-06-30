import { describe, expect, test, vi } from "vitest";
import { JSDOM } from "jsdom";

import { capturePost } from "../../extension/capture.js";

describe("Facebook post capture", () => {
  test("captures visible post text and post permalink", () => {
    const dom = new JSDOM("", {
      url: "https://www.facebook.com/groups/12345",
    });
    const document = new dom.window.DOMParser().parseFromString(
      `<article data-apt-hunt-post>
        <p>Room in Hayes Valley, $1800.</p>
        <a href="https://www.facebook.com/groups/12345/posts/67890">Permalink</a>
      </article>`,
      "text/html",
    );
    const post = document.querySelector("article");

    vi.stubGlobal("window", dom.window);

    expect(
      capturePost(post, {
        id: "12345",
        name: "SF Housing",
        url: "https://www.facebook.com/groups/12345",
      }),
    ).toMatchObject({
      sourceGroupId: "12345",
      sourceGroupName: "SF Housing",
      sourcePostUrl: "https://www.facebook.com/groups/12345/posts/67890",
      capturedText: expect.stringContaining("Room in Hayes Valley"),
    });
  });

  test("returns null on a group page when the post permalink is missing or invalid", () => {
    const dom = new JSDOM("", {
      url: "https://www.facebook.com/groups/12345",
    });
    const document = new dom.window.DOMParser().parseFromString(
      `<article>
        <p>Quiet room in the Richmond.</p>
        <a href="https://www.facebook.com/marketplace/item/1">Marketplace link</a>
        <a href="not a url">Broken permalink</a>
      </article>`,
      "text/html",
    );
    const post = document.querySelector("article");

    vi.stubGlobal("window", dom.window);

    expect(
      capturePost(post, {
        id: "12345",
        name: "SF Housing",
        url: "https://www.facebook.com/groups/12345",
      }),
    ).toBeNull();
  });

  test("returns null when the only post link is an insecure permalink", () => {
    const dom = new JSDOM("", {
      url: "https://www.facebook.com/groups/12345",
    });
    const document = new dom.window.DOMParser().parseFromString(
      `<article>
        <p>Studio near the Panhandle.</p>
        <a href="http://www.facebook.com/groups/12345/posts/67890">Insecure permalink</a>
      </article>`,
      "text/html",
    );
    const post = document.querySelector("article");

    vi.stubGlobal("window", dom.window);

    expect(
      capturePost(post, {
        id: "12345",
        name: "SF Housing",
        url: "https://www.facebook.com/groups/12345",
      }),
    ).toBeNull();
  });

  test("returns null when neither the permalink nor the page url is a valid https Facebook url", () => {
    const dom = new JSDOM("", {
      url: "http://www.facebook.com/groups/12345",
    });
    const document = new dom.window.DOMParser().parseFromString(
      `<article>
        <p>One-bedroom in Noe Valley.</p>
        <a href="https://example.com/posts/67890">Offsite permalink</a>
      </article>`,
      "text/html",
    );
    const post = document.querySelector("article");

    vi.stubGlobal("window", dom.window);

    expect(
      capturePost(post, {
        id: "12345",
        name: "SF Housing",
        url: "https://www.facebook.com/groups/12345",
      }),
    ).toBeNull();
  });

  test.each(["non-https", "offsite"])('returns null when groupContext.url is %s', (scenario) => {
    const groupUrl = scenario === "non-https" ? "http://www.facebook.com/groups/12345" : "https://example.com/groups/12345";

    const dom = new JSDOM("", {
      url: "https://www.facebook.com/groups/12345",
    });
    const document = new dom.window.DOMParser().parseFromString(
      `<article>
        <p>One-bedroom in Noe Valley.</p>
        <a href="https://www.facebook.com/groups/12345/posts/67890">Permalink</a>
      </article>`,
      "text/html",
    );
    const post = document.querySelector("article");

    vi.stubGlobal("window", dom.window);

    expect(
      capturePost(post, {
        id: "12345",
        name: "SF Housing",
        url: groupUrl,
      }),
    ).toBeNull();
  });
});

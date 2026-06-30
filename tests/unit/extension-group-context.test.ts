import { describe, expect, test } from "vitest";
import { JSDOM } from "jsdom";

import {
  parseFacebookGroupFromUrl,
  readGroupContextFromDocument,
} from "../../extension/group-context.js";

describe("Facebook group context parser", () => {
  test("parses group feed urls", () => {
    expect(parseFacebookGroupFromUrl("https://www.facebook.com/groups/12345")).toEqual({
      id: "12345",
      name: "Facebook group 12345",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("parses group post permalink urls", () => {
    expect(parseFacebookGroupFromUrl("https://www.facebook.com/groups/12345/posts/67890")).toEqual({
      id: "12345",
      name: "Facebook group 12345",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("returns null for malformed encoded group ids", () => {
    expect(parseFacebookGroupFromUrl("https://www.facebook.com/groups/%E0%A4%A")).toBeNull();
  });

  test("reads visible home-feed group attribution", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      `<article><a href="https://www.facebook.com/groups/12345">SF Housing</a></article>`,
      "text/html",
    );

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toEqual({
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("reads the page heading on a group page", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      `<main><h1>Sunset Rentals</h1><article><p>Listing</p></article></main>`,
      "text/html",
    );
    const post = document.querySelector("article");

    expect(
      readGroupContextFromDocument(post, new URL("https://www.facebook.com/groups/12345")),
    ).toEqual({
      id: "12345",
      name: "Sunset Rentals",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("ignores invalid and relative group links while scanning the home feed", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      [
        `<article>`,
        `<a href="/groups/relative-group">Relative group</a>`,
        `<a href="not a url">Broken link</a>`,
        `<a href="https://www.facebook.com/groups/12345">SF Housing</a>`,
        `</article>`,
      ].join(""),
      "text/html",
    );

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toEqual({
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    });
  });

  test("ignores group post permalinks when scanning home-feed attribution", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      [
        `<article>`,
        `<a href="https://www.facebook.com/groups/12345/posts/67890">3h</a>`,
        `</article>`,
      ].join(""),
      "text/html",
    );

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toBeNull();
  });

  test("requires visible link text when scanning home-feed attribution", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      [
        `<article>`,
        `<a href="https://www.facebook.com/groups/12345"><span aria-hidden="true"></span></a>`,
        `</article>`,
      ].join(""),
      "text/html",
    );

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toBeNull();
  });

  test("ignores hidden and screen-reader-only group attribution when scanning the home feed", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      [
        `<article>`,
        `<a href="https://www.facebook.com/groups/12345" hidden>Hidden attribute</a>`,
        `<a href="https://www.facebook.com/groups/12345" aria-hidden="true">ARIA hidden</a>`,
        `<a href="https://www.facebook.com/groups/12345" style="display:none">Display none</a>`,
        `<a href="https://www.facebook.com/groups/12345" style="visibility:hidden">Visibility hidden</a>`,
        `<a href="https://www.facebook.com/groups/12345"><span class="sr-only">Screen reader only</span></a>`,
        `<a href="https://www.facebook.com/groups/12345"><span class="visually-hidden">Visually hidden</span></a>`,
        `</article>`,
      ].join(""),
      "text/html",
    );

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toBeNull();
  });

  test("ignores stylesheet-hidden group attribution when scanning the home feed", () => {
    const dom = new JSDOM(
      [
        `<!doctype html>`,
        `<style>.ghost-hidden { display: none; }</style>`,
        `<article>`,
        `<a href="https://www.facebook.com/groups/12345"><span class="ghost-hidden">SF Housing</span></a>`,
        `</article>`,
      ].join(""),
      { url: "https://www.facebook.com/" },
    );
    const document = dom.window.document;

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toBeNull();
  });

  test("reads only visible text from home-feed group attribution", () => {
    const window = new JSDOM("").window;
    const document = new window.DOMParser().parseFromString(
      [
        `<article>`,
        `<a href="https://www.facebook.com/groups/12345">`,
        `<span class="sr-only">Hidden prefix</span>`,
        `<span>SF Housing</span>`,
        `<span style="display:none">Hidden suffix</span>`,
        `</a>`,
        `</article>`,
      ].join(""),
      "text/html",
    );

    expect(readGroupContextFromDocument(document, new URL("https://www.facebook.com/"))).toEqual({
      id: "12345",
      name: "SF Housing",
      url: "https://www.facebook.com/groups/12345",
    });
  });
});

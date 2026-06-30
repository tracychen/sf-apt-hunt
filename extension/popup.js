import { appOrigin } from "./config.js";
import {
  getAllowlistedGroups,
  getOpenAiKey,
  removeAllowlistedGroup,
  saveAllowlistedGroup,
  setOpenAiKey,
} from "./storage.js";

const connectionEl = document.querySelector("#connection");
const openAiKeyEl = document.querySelector("#openai-key");
const allowlistEl = document.querySelector("#allowlist");

render();

async function render() {
  const response = await chrome.runtime.sendMessage({ type: "apt-hunt-get-connection" });
  const connection = response?.ok ? response.connection : null;

  renderConnection(connection);
  bindConnectionActions();

  await renderOpenAiKey();

  const [groups, activeGroup] = await Promise.all([getAllowlistedGroups(), readActiveTabGroup()]);
  renderAllowlist(groups, activeGroup);
}

function renderConnection(connection) {
  connectionEl.replaceChildren();

  if (connection) {
    const stack = document.createElement("div");
    stack.className = "stack";

    const status = document.createElement("p");
    status.className = "status";
    status.textContent = `Connected as ${String(connection.accountEmail ?? "unknown")}`;

    const workspace = document.createElement("p");
    workspace.className = "meta";
    workspace.textContent = connection.workspaceName
      ? String(connection.workspaceName)
      : "Workspace unavailable";

    const button = document.createElement("button");
    button.id = "disconnect";
    button.type = "button";
    button.textContent = "Disconnect";

    stack.append(status, workspace, button);
    connectionEl.append(stack);
    return;
  }

  const stack = document.createElement("div");
  stack.className = "stack";

  const hint = document.createElement("p");
  hint.className = "meta";
  hint.textContent = "Connect the extension from Apt Hunt to start saving listings.";

  const button = document.createElement("button");
  button.id = "connect";
  button.type = "button";
  button.textContent = "Connect Apt Hunt";

  stack.append(hint, button);
  connectionEl.append(stack);
}

function bindConnectionActions() {
  document.querySelector("#connect")?.addEventListener("click", () => {
    chrome.tabs.create({
      url: `${appOrigin}/extension/connect?extensionId=${chrome.runtime.id}`,
    });
  });

  document.querySelector("#disconnect")?.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "apt-hunt-disconnect" });
    if (!response?.ok) {
      window.alert("Disconnect failed.");
      return;
    }

    await render();
  });
}

function renderAllowlist(groups, activeGroup = null) {
  allowlistEl.replaceChildren();

  const title = document.createElement("h2");
  title.textContent = "Allowlisted groups";
  allowlistEl.append(title);

  if (activeGroup) {
    const button = document.createElement("button");
    button.id = "add-current-group";
    button.type = "button";
    button.textContent = groups.some((group) => group.id === activeGroup.id)
      ? "Update current group"
      : "Add current group";
    button.addEventListener("click", async () => {
      await saveAllowlistedGroup(activeGroup);
      await refreshAllowlist();
    });
    allowlistEl.append(button);
  }

  allowlistEl.append(createAllowlistForm());

  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No groups saved yet.";
    allowlistEl.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "group-list";

  for (const group of groups) {
    const item = document.createElement("li");
    item.className = "group-item";

    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = String(group.name ?? "Unnamed group");

    const url = document.createElement("a");
    url.className = "group-url";
    url.href = safeHttpUrl(group.url) ?? "#";
    url.target = "_blank";
    url.rel = "noreferrer";
    url.textContent = String(group.id ?? "");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary";
    removeButton.dataset.allowlistRemoveId = String(group.id ?? "");
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", async () => {
      await removeAllowlistedGroup(String(group.id ?? ""));
      await refreshAllowlist();
    });

    item.append(name, url, removeButton);
    list.append(item);
  }

  allowlistEl.append(list);
}

function createAllowlistForm() {
  const form = document.createElement("form");
  form.id = "allowlist-form";
  form.className = "stack";

  const urlInput = document.createElement("input");
  urlInput.id = "allowlist-url";
  urlInput.name = "url";
  urlInput.type = "url";
  urlInput.placeholder = "Facebook group URL";
  urlInput.autocomplete = "off";
  urlInput.required = true;

  const nameInput = document.createElement("input");
  nameInput.id = "allowlist-name";
  nameInput.name = "name";
  nameInput.type = "text";
  nameInput.placeholder = "Display name";
  nameInput.autocomplete = "off";

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Save group";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const group = parseFacebookGroup(urlInput.value, nameInput.value);
    if (!group) {
      window.alert("Enter a valid Facebook group URL.");
      return;
    }

    await saveAllowlistedGroup(group);
    urlInput.value = "";
    nameInput.value = "";
    await refreshAllowlist();
  });

  form.append(urlInput, nameInput, button);
  return form;
}

async function refreshAllowlist() {
  const [groups, activeGroup] = await Promise.all([getAllowlistedGroups(), readActiveTabGroup()]);
  renderAllowlist(groups, activeGroup);
}

async function renderOpenAiKey() {
  if (!openAiKeyEl) {
    return;
  }

  const key = await getOpenAiKey();
  openAiKeyEl.replaceChildren();

  const stack = document.createElement("div");
  stack.className = "stack";

  const title = document.createElement("h2");
  title.textContent = "AI parsing";

  const hint = document.createElement("p");
  hint.className = "meta";
  hint.textContent = "Stored only in this browser for the optional review parser.";

  const input = document.createElement("input");
  input.id = "openai-key-input";
  input.type = "password";
  input.placeholder = "OpenAI API key";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = key;

  const button = document.createElement("button");
  button.id = "save-openai-key";
  button.type = "button";
  button.textContent = "Save key";
  button.addEventListener("click", async () => {
    await setOpenAiKey(input.value);
    await renderOpenAiKey();
  });

  stack.append(title, hint, input, button);
  openAiKeyEl.append(stack);
}

function safeHttpUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function readActiveTabGroup() {
  if (!chrome.tabs?.query) {
    return null;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab = Array.isArray(tabs) ? tabs[0] : null;

  if (!tab?.url) {
    return null;
  }

  return parseFacebookGroup(tab.url, readTitleName(tab.title));
}

function parseFacebookGroup(urlValue, nameValue) {
  const url = safeUrl(urlValue);

  if (!url || url.protocol !== "https:" || !isFacebookHostname(url.hostname)) {
    return null;
  }

  const match = url.pathname.match(/^\/groups\/([^/?#]+)(?:\/|$)/);

  if (!match) {
    return null;
  }

  const id = safeDecodeURIComponent(match[1]);

  if (!id) {
    return null;
  }

  const name = String(nameValue ?? "").trim() || `Facebook group ${id}`;

  return {
    id,
    name,
    url: `https://www.facebook.com/groups/${encodeURIComponent(id)}`,
  };
}

function readTitleName(title) {
  if (typeof title !== "string") {
    return "";
  }

  return title.replace(/\s*\|\s*Facebook\s*$/i, "").trim();
}

function isFacebookHostname(hostname) {
  return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function safeUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

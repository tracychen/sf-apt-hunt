const connectionKey = "aptHuntConnection";
const allowlistKey = "aptHuntAllowlistedGroups";
const openAiKey = "aptHuntOpenAiKey";

export async function getConnection() {
  const value = await chrome.storage.local.get([connectionKey]);
  return value[connectionKey] ?? null;
}

export async function setConnection(connection) {
  await chrome.storage.local.set({ [connectionKey]: connection });
}

export async function clearConnection() {
  await chrome.storage.local.remove(connectionKey);
}

export async function getAllowlistedGroups() {
  const value = await chrome.storage.local.get([allowlistKey]);
  return Array.isArray(value[allowlistKey]) ? value[allowlistKey] : [];
}

export async function saveAllowlistedGroup(group) {
  const groups = await getAllowlistedGroups();
  const next = [...groups.filter((existing) => existing.id !== group.id), group].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  await chrome.storage.local.set({ [allowlistKey]: next });
  return next;
}

export async function removeAllowlistedGroup(id) {
  const next = (await getAllowlistedGroups()).filter((group) => group.id !== id);
  await chrome.storage.local.set({ [allowlistKey]: next });
  return next;
}

export async function getOpenAiKey() {
  const value = await chrome.storage.local.get([openAiKey]);
  return typeof value[openAiKey] === "string" ? value[openAiKey] : "";
}

export async function setOpenAiKey(key) {
  const trimmed = key.trim();

  if (!trimmed) {
    await chrome.storage.local.remove(openAiKey);
    return "";
  }

  await chrome.storage.local.set({ [openAiKey]: trimmed });
  return trimmed;
}

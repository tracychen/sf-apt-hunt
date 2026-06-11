const openAiKeyStorageKey = "sf-apt-hunt:openai-key";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type ApiKeyStorage = {
  localStorage?: StorageLike | null;
  sessionStorage?: StorageLike | null;
};

export type StoredOpenAiKey = {
  key: string | null;
  remembered: boolean;
};

function getBrowserStorage(): ApiKeyStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return {
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
  };
}

function resolveStorage(storage?: ApiKeyStorage): ApiKeyStorage | null {
  return storage ?? getBrowserStorage();
}

export function saveOpenAiKey(key: string, remember: boolean, storage?: ApiKeyStorage) {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return;
  }

  resolvedStorage.localStorage?.removeItem(openAiKeyStorageKey);
  resolvedStorage.sessionStorage?.removeItem(openAiKeyStorageKey);

  if (remember) {
    resolvedStorage.localStorage?.setItem(openAiKeyStorageKey, key);
    return;
  }

  resolvedStorage.sessionStorage?.setItem(openAiKeyStorageKey, key);
}

export function loadStoredOpenAiKey(storage?: ApiKeyStorage): StoredOpenAiKey {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return { key: null, remembered: false };
  }

  const rememberedKey = resolvedStorage.localStorage?.getItem(openAiKeyStorageKey) ?? null;
  if (rememberedKey !== null) {
    return { key: rememberedKey, remembered: true };
  }

  const sessionKey = resolvedStorage.sessionStorage?.getItem(openAiKeyStorageKey) ?? null;
  return { key: sessionKey, remembered: false };
}

export function clearStoredOpenAiKey(storage?: ApiKeyStorage) {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return;
  }

  resolvedStorage.localStorage?.removeItem(openAiKeyStorageKey);
  resolvedStorage.sessionStorage?.removeItem(openAiKeyStorageKey);
}

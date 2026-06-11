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

  try {
    return {
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    };
  } catch {
    return null;
  }
}

function resolveStorage(storage?: ApiKeyStorage): ApiKeyStorage | null {
  try {
    return storage ?? getBrowserStorage();
  } catch {
    return null;
  }
}

function safeGetItem(storage: StorageLike | null | undefined, key: string) {
  if (!storage) {
    return { ok: true, value: null };
  }

  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeRemoveItem(storage: StorageLike | null | undefined, key: string) {
  if (!storage) {
    return true;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeSetItem(storage: StorageLike | null | undefined, key: string, value: string) {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function saveOpenAiKey(key: string, remember: boolean, storage?: ApiKeyStorage) {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return;
  }

  const removedStoredKey =
    safeRemoveItem(resolvedStorage.localStorage, openAiKeyStorageKey) &&
    safeRemoveItem(resolvedStorage.sessionStorage, openAiKeyStorageKey);

  if (!removedStoredKey) {
    return;
  }

  if (remember) {
    safeSetItem(resolvedStorage.localStorage, openAiKeyStorageKey, key);
    return;
  }

  safeSetItem(resolvedStorage.sessionStorage, openAiKeyStorageKey, key);
}

export function loadStoredOpenAiKey(storage?: ApiKeyStorage): StoredOpenAiKey {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return { key: null, remembered: false };
  }

  const rememberedKey = safeGetItem(resolvedStorage.localStorage, openAiKeyStorageKey);
  if (!rememberedKey.ok) {
    return { key: null, remembered: false };
  }

  if (rememberedKey.value !== null) {
    return { key: rememberedKey.value, remembered: true };
  }

  const sessionKey = safeGetItem(resolvedStorage.sessionStorage, openAiKeyStorageKey);
  if (!sessionKey.ok) {
    return { key: null, remembered: false };
  }

  return { key: sessionKey.value, remembered: false };
}

export function clearStoredOpenAiKey(storage?: ApiKeyStorage) {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return;
  }

  safeRemoveItem(resolvedStorage.localStorage, openAiKeyStorageKey);
  safeRemoveItem(resolvedStorage.sessionStorage, openAiKeyStorageKey);
}

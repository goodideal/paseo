import { useCallback, useSyncExternalStore } from "react";
import { Platform } from "react-native";

export const DEFAULT_MEMBER_STORAGE_KEY = "team-collab.default-member-id" as const;

interface MinimalWebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let memoryDefaultMemberId: string | null = null;
let hydratedFromWebStorage = false;
const listeners = new Set<() => void>();

function getWebLocalStorage(): MinimalWebStorage | null {
  if (Platform.OS !== "web") {
    return null;
  }
  try {
    const candidate = (globalThis as { localStorage?: MinimalWebStorage }).localStorage;
    return candidate && typeof candidate.getItem === "function" ? candidate : null;
  } catch {
    return null;
  }
}

function normalizeMemberId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getDefaultMemberId(): string | null {
  const storage = getWebLocalStorage();
  if (storage && !hydratedFromWebStorage) {
    hydratedFromWebStorage = true;
    try {
      memoryDefaultMemberId = normalizeMemberId(storage.getItem(DEFAULT_MEMBER_STORAGE_KEY));
    } catch {
      // Keep in-memory value when web storage read is blocked
    }
  }
  return memoryDefaultMemberId;
}

export function setDefaultMemberId(nextId: string | null): void {
  const normalized = normalizeMemberId(nextId);
  const current = getDefaultMemberId();
  memoryDefaultMemberId = normalized;
  hydratedFromWebStorage = true;

  const storage = getWebLocalStorage();
  if (storage) {
    try {
      if (normalized === null) {
        storage.removeItem(DEFAULT_MEMBER_STORAGE_KEY);
      } else {
        storage.setItem(DEFAULT_MEMBER_STORAGE_KEY, normalized);
      }
    } catch {
      // Keep in-memory state even if web storage quota/privacy mode rejects writes
    }
  }

  if (current !== normalized) {
    for (const listener of listeners) {
      listener();
    }
  }
}

export function subscribeDefaultMemberId(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDefaultMemberId(): readonly [string | null, (nextId: string | null) => void] {
  const value = useSyncExternalStore(
    subscribeDefaultMemberId,
    getDefaultMemberId,
    getDefaultMemberId,
  );
  const update = useCallback((nextId: string | null) => {
    setDefaultMemberId(nextId);
  }, []);
  return [value, update] as const;
}

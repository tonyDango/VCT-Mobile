import AsyncStorage from "@react-native-async-storage/async-storage";

export type PersistedEnvelope<T> = {
  v: number;
  savedAt: number;
  data: T;
};

const DEFAULT_VERSION = 1;

export async function loadPersisted<T>(key: string): Promise<PersistedEnvelope<T> | null> {
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedEnvelope<T>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.v !== "number" || typeof parsed.savedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function savePersisted<T>(key: string, data: T, version = DEFAULT_VERSION) {
  if (!key) return;
  const envelope: PersistedEnvelope<T> = { v: version, savedAt: Date.now(), data };
  await AsyncStorage.setItem(key, JSON.stringify(envelope));
}

export async function setFlag(key: string, value: boolean) {
  await AsyncStorage.setItem(key, value ? "1" : "0");
}

export async function getFlag(key: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(key);
  return raw === "1";
}


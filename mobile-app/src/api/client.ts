import { API_BASE_URL } from "../config";

const API_TIMEOUT_MS = Math.max(0, Number(process.env.EXPO_PUBLIC_API_TIMEOUT_MS || 25000));
const API_RETRY = Math.max(0, Number(process.env.EXPO_PUBLIC_API_RETRY || 1));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/请求超时|aborted|network request failed|network error/i.test(message)) return true;
  if (/请求失败:\s*5\d\d/i.test(message)) return true;
  return false;
}

async function apiGetOnce<T>(path: string): Promise<T> {
  const controller = API_TIMEOUT_MS > 0 ? new AbortController() : null;
  const timeout = API_TIMEOUT_MS > 0 ? setTimeout(() => controller?.abort(), API_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) {
      let message = `请求失败: ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) {
          message = body.error;
        }
      } catch {
        // ignore json parsing error
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时(${Math.round(API_TIMEOUT_MS / 1000)}s)`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= API_RETRY; attempt += 1) {
    try {
      return await apiGetOnce<T>(path);
    } catch (error) {
      lastError = error;
      if (attempt >= API_RETRY || !isRetryableError(error)) break;
      await sleep((attempt + 1) * 300);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("请求失败");
}

export function withQuery(path: string, query: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

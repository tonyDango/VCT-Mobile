import type { PlayerDirectoryItem } from "../api/types";
import { getPlayerBasic } from "../api/vlrApi";

export function normalizeImageUrl(raw?: string | null) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  return text;
}

export function playerIdsFromRoster(list: PlayerDirectoryItem[] | null | undefined) {
  const out: number[] = [];
  for (const p of list || []) {
    const id = Number(p.player_id);
    if (Number.isFinite(id) && id > 0) out.push(id);
  }
  return out;
}

export async function fetchPlayerAvatarMap(
  playerIds: number[],
  existing: Record<number, string | null> = {},
  concurrency = 10
): Promise<Record<number, string | null>> {
  const ids = Array.from(new Set(playerIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (!ids.length) return { ...existing };

  const next: Record<number, string | null> = { ...existing };
  const missing = ids.filter((id) => next[id] === undefined);
  if (!missing.length) return next;

  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= missing.length) break;
      const id = missing[idx]!;
      try {
        const data = await getPlayerBasic(id);
        const avatar = normalizeImageUrl((data?.avatar_url as string | undefined) || null);
        next[id] = avatar;
      } catch {
        next[id] = null;
      }
    }
  }

  const pool = Math.max(1, Math.min(concurrency, 20));
  await Promise.all(Array.from({ length: Math.min(pool, missing.length) }, () => worker()));
  return next;
}


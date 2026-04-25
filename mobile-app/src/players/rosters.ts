import { PlayerDirectoryItem, TeamSelectorRegion } from "../api/types";
import { getTeamRoster } from "../api/vlrApi";

export type PlayerRegionValue = "americas" | "emea" | "pacific" | "china";

const ROSTER_FETCH_CONCURRENCY = 5;

export function normalizeSelectorRegion(region?: string): PlayerRegionValue | "" {
  const src = (region || "").trim().toLowerCase();
  if (src.includes("china")) return "china";
  if (src.includes("pacific")) return "pacific";
  if (src.includes("americas")) return "americas";
  if (src.includes("emea")) return "emea";
  return "";
}

export function regionTeamsFromSelector(
  selectorItems: TeamSelectorRegion[] | undefined | null,
  selectedRegion: PlayerRegionValue
) {
  const rows = (selectorItems || []) as TeamSelectorRegion[];
  const seen = new Set<number>();
  const out: Array<{ team_id: number; name: string }> = [];
  for (const row of rows) {
    const region = normalizeSelectorRegion(row.region);
    if (region !== selectedRegion) continue;
    for (const team of row.teams || []) {
      const id = team.team_id;
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push({ team_id: id, name: team.name || `Team ${id}` });
    }
  }
  return out;
}

export function buildRosterCacheKey(selectedRegion: PlayerRegionValue, teams: Array<{ team_id: number; name: string }>) {
  const regionTeamKey = teams
    .map((t) => t.team_id)
    .filter((id): id is number => Number.isFinite(id))
    .sort((a, b) => a - b)
    .join(",");
  return regionTeamKey ? `${selectedRegion}:${regionTeamKey}` : "";
}

/** 仅排除明确非选手身份；role 为空时仍视为选手（上游字段常缺失）。 */
function rosterEntryExcludedAsNonPlayer(role: unknown) {
  const r = String(role || "").trim().toLowerCase();
  if (!r) return false;
  return r !== "player";
}

/** 赛区 → 该赛区 selector 内所有队伍 → 各队 roster 合并去重（与「从大列表猜赛区」相比不会漏人）。 */
export async function fetchPlayersFromRegionRosters(
  teams: Array<{ team_id: number; name: string }>
): Promise<PlayerDirectoryItem[]> {
  if (!teams.length) return [];
  const byId = new Map<number, PlayerDirectoryItem>();
  let cursor = 0;

  async function fetchOne(team: { team_id: number; name: string }) {
    try {
      const { items } = await getTeamRoster(team.team_id);
      for (const m of items || []) {
        if (rosterEntryExcludedAsNonPlayer(m.role)) continue;
        const pid = Number(m.player_id);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        const ign = (m.ign || "").trim();
        const realName = (m.real_name || "").trim();
        const existing = byId.get(pid);
        if (existing) {
          if (!existing.current_teams.includes(team.name)) {
            existing.current_teams = [...existing.current_teams, team.name];
          }
        } else {
          byId.set(pid, {
            player_id: pid,
            ign: ign || realName || `Player ${pid}`,
            real_name: realName || undefined,
            country: m.country,
            status: "active",
            current_teams: [team.name],
            history_teams: [],
          });
        }
      }
    } catch {
      // 单队失败不拖垮整页
    }
  }

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= teams.length) break;
      await fetchOne(teams[idx]!);
    }
  }

  await Promise.all(Array.from({ length: ROSTER_FETCH_CONCURRENCY }, () => worker()));
  return Array.from(byId.values()).sort((a, b) =>
    (a.ign || "").toLowerCase().localeCompare((b.ign || "").toLowerCase(), "en")
  );
}


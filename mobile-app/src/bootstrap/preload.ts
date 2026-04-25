import { getEvents, getHomeVctMatches, getLiveMatches, getTeamSelector } from "../api/vlrApi";
import { savePersisted, getFlag, setFlag } from "../storage/persist";
import { buildRosterCacheKey, fetchPlayersFromRegionRosters, regionTeamsFromSelector } from "../players/rosters";
import type { TeamSelectorRegion } from "../api/types";
import { fetchPlayerAvatarMap, playerIdsFromRoster } from "../players/avatars";
import { loadPersisted } from "../storage/persist";
import type { PlayerDirectoryItem } from "../api/types";

export type PreloadStep = {
  key: string;
  label: string;
  run: () => Promise<void>;
};

export type PreloadProgress = {
  stepIndex: number;
  totalSteps: number;
  label: string;
  ratio: number;
};

const BOOTSTRAP_DONE_FLAG = "bootstrap:done:v1";

export const PERSIST_KEYS = {
  homeTeamSelector: "persist:home:teamSelector:v1",
  homeLiveMatches: "persist:home:liveMatches:v1",
  homeVctUpcoming: "persist:home:vctUpcoming:v1",
  homeVctCompleted: "persist:home:vctCompleted:v1",

  matchesLive: "persist:matches:live:v1",
  matchesVctUpcoming: "persist:matches:vctUpcoming:v1",
  matchesVctCompleted: "persist:matches:vctCompleted:v1",

  eventsOngoing: "persist:events:ongoing:v1",
  eventsUpcoming: "persist:events:upcoming:v1",
  eventsCompleted: "persist:events:completed:v1",

  playersTeamSelector: "persist:players:teamSelector:v1",
} as const;

function buildSteps(): PreloadStep[] {
  let selectorItems: TeamSelectorRegion[] | null = null;
  let rosterAmericas: PlayerDirectoryItem[] | null = null;
  let rosterEmea: PlayerDirectoryItem[] | null = null;
  let rosterPacific: PlayerDirectoryItem[] | null = null;
  let rosterChina: PlayerDirectoryItem[] | null = null;
  return [
    {
      key: "home.teamSelector",
      label: "加载主队与赛区列表",
      run: async () => {
        const data = await getTeamSelector(4);
        selectorItems = (data?.items || []) as TeamSelectorRegion[];
        await savePersisted(PERSIST_KEYS.homeTeamSelector, data, 1);
        await savePersisted(PERSIST_KEYS.playersTeamSelector, data, 1);
      },
    },
    {
      key: "players.roster.americas",
      label: "加载选手名单（Americas）",
      run: async () => {
        const items = selectorItems || ((await getTeamSelector(4))?.items as TeamSelectorRegion[]) || [];
        const teams = regionTeamsFromSelector(items, "americas");
        const rosterKey = buildRosterCacheKey("americas", teams);
        if (!rosterKey) return;
        const list = await fetchPlayersFromRegionRosters(teams);
        rosterAmericas = list;
        await savePersisted(`persist:players:roster:${rosterKey}:v1`, list, 1);
      },
    },
    {
      key: "players.roster.emea",
      label: "加载选手名单（EMEA）",
      run: async () => {
        const items = selectorItems || ((await getTeamSelector(4))?.items as TeamSelectorRegion[]) || [];
        const teams = regionTeamsFromSelector(items, "emea");
        const rosterKey = buildRosterCacheKey("emea", teams);
        if (!rosterKey) return;
        const list = await fetchPlayersFromRegionRosters(teams);
        rosterEmea = list;
        await savePersisted(`persist:players:roster:${rosterKey}:v1`, list, 1);
      },
    },
    {
      key: "players.roster.pacific",
      label: "加载选手名单（Pacific）",
      run: async () => {
        const items = selectorItems || ((await getTeamSelector(4))?.items as TeamSelectorRegion[]) || [];
        const teams = regionTeamsFromSelector(items, "pacific");
        const rosterKey = buildRosterCacheKey("pacific", teams);
        if (!rosterKey) return;
        const list = await fetchPlayersFromRegionRosters(teams);
        rosterPacific = list;
        await savePersisted(`persist:players:roster:${rosterKey}:v1`, list, 1);
      },
    },
    {
      key: "players.roster.china",
      label: "加载选手名单（China）",
      run: async () => {
        const items = selectorItems || ((await getTeamSelector(4))?.items as TeamSelectorRegion[]) || [];
        const teams = regionTeamsFromSelector(items, "china");
        const rosterKey = buildRosterCacheKey("china", teams);
        if (!rosterKey) return;
        const list = await fetchPlayersFromRegionRosters(teams);
        rosterChina = list;
        await savePersisted(`persist:players:roster:${rosterKey}:v1`, list, 1);
      },
    },
    {
      key: "players.avatars",
      label: "加载选手头像",
      run: async () => {
        const key = "persist:players:avatars:v1";
        const cached = await loadPersisted<Record<number, string | null>>(key);
        const existing = cached?.data || {};

        const ids = [
          ...playerIdsFromRoster(rosterAmericas),
          ...playerIdsFromRoster(rosterEmea),
          ...playerIdsFromRoster(rosterPacific),
          ...playerIdsFromRoster(rosterChina),
        ];
        const next = await fetchPlayerAvatarMap(ids, existing, 10);
        await savePersisted(key, next, 1);
      },
    },
    {
      key: "home.liveMatches",
      label: "加载进行中比赛",
      run: async () => {
        const data = await getLiveMatches(50);
        await savePersisted(PERSIST_KEYS.homeLiveMatches, data, 1);
        await savePersisted(PERSIST_KEYS.matchesLive, data, 1);
      },
    },
    {
      key: "home.vctUpcoming",
      label: "加载近期比赛（Upcoming）",
      run: async () => {
        const data = await getHomeVctMatches("upcoming", 150, 2);
        await savePersisted(PERSIST_KEYS.homeVctUpcoming, data, 1);
        await savePersisted(PERSIST_KEYS.matchesVctUpcoming, data, 1);
      },
    },
    {
      key: "home.vctCompleted",
      label: "加载近期比赛（Completed）",
      run: async () => {
        const data = await getHomeVctMatches("completed", 120, 2);
        await savePersisted(PERSIST_KEYS.homeVctCompleted, data, 1);
        await savePersisted(PERSIST_KEYS.matchesVctCompleted, data, 1);
      },
    },
    {
      key: "events.ongoing",
      label: "加载进行中赛事",
      run: async () => {
        const data = await getEvents("ongoing", 60);
        await savePersisted(PERSIST_KEYS.eventsOngoing, data, 1);
      },
    },
    {
      key: "events.upcoming",
      label: "加载赛事列表（Upcoming）",
      run: async () => {
        const data = await getEvents("upcoming", 120);
        await savePersisted(PERSIST_KEYS.eventsUpcoming, data, 1);
      },
    },
    {
      key: "events.completed",
      label: "加载赛事列表（Completed）",
      run: async () => {
        const data = await getEvents("completed", 120);
        await savePersisted(PERSIST_KEYS.eventsCompleted, data, 1);
      },
    },
  ];
}

export async function isBootstrapDone() {
  return getFlag(BOOTSTRAP_DONE_FLAG);
}

export async function markBootstrapDone() {
  return setFlag(BOOTSTRAP_DONE_FLAG, true);
}

export async function runInitialPreload(onProgress?: (p: PreloadProgress) => void) {
  const steps = buildSteps();
  const totalSteps = steps.length;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    onProgress?.({
      stepIndex: i,
      totalSteps,
      label: step.label,
      ratio: totalSteps ? i / totalSteps : 0,
    });
    await step.run();
    onProgress?.({
      stepIndex: i + 1,
      totalSteps,
      label: step.label,
      ratio: totalSteps ? (i + 1) / totalSteps : 1,
    });
  }
  await markBootstrapDone();
}

/** 后续启动：不阻塞进主页，后台刷新本地持久化。 */
export async function runBackgroundRefresh() {
  const steps = buildSteps();
  await Promise.all(
    steps.map(async (s) => {
      try {
        await s.run();
      } catch {
        // 后台刷新失败不影响启动
      }
    })
  );
}


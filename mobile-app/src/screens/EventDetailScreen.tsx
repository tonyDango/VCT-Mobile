import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EventMatchItem, MatchDetailResponse, MatchDetailTeam, MatchMapTeamScore, MatchTeam } from "../api/types";
import { getEventDetail, getEventMatches, getMatchDetail } from "../api/vlrApi";
import { eventEmojiForMeta, eventIconUriForMeta, metaFromDetailInfo } from "../config/eventDisplay";
import { HOME_IMAGE_URLS } from "../config/homeConfig";
import { useAsyncData } from "../hooks/useAsyncData";
import { RootStackParamList } from "../navigation/types";

type EventDetailRoute = RouteProp<RootStackParamList, "EventDetail">;
type Nav = NativeStackNavigationProp<RootStackParamList>;
type StageMode = "group_playoffs" | "swiss_playoffs" | "single";
type StageTab = "group" | "swiss" | "playoffs" | "matches";

type EventInfoLite = {
  name?: string;
  date_text?: string;
  start_date?: string;
  end_date?: string;
  regions?: string[];
};

type TeamStandingRow = {
  key: string;
  teamId?: number;
  teamName: string;
  teamShort: string;
  logoUri?: string | null;
  seriesWin: number;
  seriesLoss: number;
  mapWin: number;
  mapLoss: number;
  roundWin: number;
  roundLoss: number;
  roundDiff: number;
};

type SubGroupPlan = {
  tokens: string[];
  byMatchId: Record<number, string>;
  byTeamKey: Record<string, string>;
};

const MATCH_DETAIL_CACHE: Record<number, MatchDetailResponse | null> = {};
const MATCH_DETAIL_INFLIGHT: Record<number, Promise<MatchDetailResponse | null>> = {};
const EMPTY_SUB_GROUP_PLAN: SubGroupPlan = { tokens: [], byMatchId: {}, byTeamKey: {} };

export function EventDetailScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<EventDetailRoute>();
  const navigation = useNavigation<Nav>();
  const { eventId } = route.params;
  const detailCacheRef = useRef<Record<number, MatchDetailResponse | null>>({});

  const detailHook = useAsyncData(() => getEventDetail(eventId), [eventId]);
  const matchesHook = useAsyncData(() => getEventMatches(eventId), [eventId]);

  const eventInfo = ((detailHook.data?.info as EventInfoLite | undefined) || {}) as EventInfoLite;

  const allMatches = (matchesHook.data?.items || []) as EventMatchItem[];
  const stageMode = useMemo(() => detectStageMode(allMatches), [allMatches]);
  const stageOptions = useMemo(() => stageOptionsForMode(stageMode), [stageMode]);
  const [stageTab, setStageTab] = useState<StageTab>(stageOptions[0]?.value || "matches");
  const [subGroup, setSubGroup] = useState<string | null>(null);

  useEffect(() => {
    const valid = stageOptions.map((opt) => opt.value);
    if (!valid.includes(stageTab)) {
      setStageTab(valid[0] || "matches");
    }
  }, [stageOptions, stageTab]);

  const stageMatches = useMemo(() => filterMatchesByTab(allMatches, stageTab), [allMatches, stageTab]);
  const subGroupEnabled = stageTab === "group";
  const championsMode = useMemo(() => isChampionsEvent(eventInfo), [eventInfo]);
  const subGroupPlan = useMemo(
    () => (subGroupEnabled ? buildSubGroupPlan(stageMatches, championsMode) : EMPTY_SUB_GROUP_PLAN),
    [stageMatches, subGroupEnabled, championsMode]
  );
  const subGroups = subGroupPlan.tokens;

  useEffect(() => {
    if (!subGroupEnabled) {
      setSubGroup(null);
      return;
    }
    if (!subGroups.length) {
      setSubGroup(null);
      return;
    }
    if (!subGroup || !subGroups.includes(subGroup)) {
      setSubGroup(subGroups[0]);
    }
  }, [subGroups, subGroup, subGroupEnabled]);

  const activeSubGroup = useMemo(() => {
    if (!subGroupEnabled) return null;
    if (!subGroups.length) return null;
    if (subGroup && subGroups.includes(subGroup)) return subGroup;
    return subGroups[0];
  }, [subGroups, subGroup, subGroupEnabled]);

  const activeStageMatches = useMemo(() => {
    if (!activeSubGroup) return stageMatches;
    return stageMatches.filter((m) => subGroupPlan.byMatchId[m.match_id] === activeSubGroup);
  }, [stageMatches, activeSubGroup, subGroupPlan]);

  const activeMatchKey = useMemo(
    () => activeStageMatches.map((m) => String(m.match_id)).join("|"),
    [activeStageMatches]
  );
  const matchMetaHook = useAsyncData(async () => {
    const ids = activeStageMatches.slice(0, 24).map((m) => m.match_id);
    await ensureMatchDetails(ids, detailCacheRef.current);
    const out: Record<number, MatchDetailResponse | null> = {};
    for (const id of ids) {
      out[id] = detailCacheRef.current[id] ?? null;
    }
    return out;
  }, [eventId, activeMatchKey]);

  const standingsEnabled = stageTab === "group" || stageTab === "swiss";
  const standingsKey = useMemo(
    () => activeStageMatches.map((m) => `${m.match_id}:${m.status}`).join("|"),
    [activeStageMatches]
  );

  const standingsHook = useAsyncData(async () => {
    if (!standingsEnabled) return [] as TeamStandingRow[];
    const completedIds = activeStageMatches.filter((m) => m.status === "completed").map((m) => m.match_id);
    await ensureMatchDetails(completedIds, detailCacheRef.current);
    return buildTeamStandings(activeStageMatches, detailCacheRef.current);
  }, [eventId, standingsEnabled, standingsKey]);

  const eventDisplayMeta = useMemo(() => metaFromDetailInfo(eventInfo), [eventInfo]);
  const topIconUri = eventIconUriForMeta(eventDisplayMeta);
  const regionEmoji = eventEmojiForMeta(eventDisplayMeta);
  const dateText = eventDateText(eventInfo);

  return (
    <View style={styles.safe}>
      {detailHook.loading && !detailHook.data ? (
        <View style={[styles.safe, styles.centerFull]}>
          <ActivityIndicator size="small" color="#111827" />
        </View>
      ) : detailHook.error && !detailHook.data ? (
        <View style={[styles.safe, styles.centerFull]}>
          <Text style={styles.errorText}>{detailHook.error}</Text>
          <Pressable style={styles.retryBtn} onPress={detailHook.reload}>
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}>
          <View style={styles.headerCard}>
            {topIconUri ? (
              <Image source={{ uri: topIconUri }} style={styles.headerIcon} resizeMode="contain" />
            ) : (
              <View style={styles.headerIconFallback} />
            )}
            <Text style={styles.headerTitle}>{eventInfo.name || `Event #${eventId}`}</Text>
            <Text style={styles.headerDate}>
              {dateText} | {regionEmoji}
            </Text>
          </View>

          {stageOptions.length > 1 && (
            <View style={styles.stageToggleWrap}>
              {stageOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setStageTab(opt.value)}
                  style={[styles.stageToggleBtn, stageTab === opt.value && styles.stageToggleBtnActive]}
                >
                  <Text style={[styles.stageToggleText, stageTab === opt.value && styles.stageToggleTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {subGroupEnabled && subGroups.length > 1 && (
            <View style={styles.subGroupWrap}>
              {subGroups.map((token) => (
                <Pressable
                  key={token}
                  onPress={() => setSubGroup(token)}
                  style={[styles.subGroupBtn, activeSubGroup === token && styles.subGroupBtnActive]}
                >
                  <Text style={[styles.subGroupText, activeSubGroup === token && styles.subGroupTextActive]}>
                    {subGroupLabel(token)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {standingsEnabled && (
            <View style={styles.tableCard}>
              {standingsHook.loading ? (
                <LoadingInCard text="正在计算小组数据..." />
              ) : standingsHook.error ? (
                <CardText text="小组数据加载失败" />
              ) : (standingsHook.data || []).length === 0 ? (
                <CardText text="暂无可用小组数据" />
              ) : (
                (standingsHook.data || []).map((row, index, arr) => (
                  <StandingsRow key={row.key} row={row} index={index} total={arr.length} stageTab={stageTab} />
                ))
              )}
            </View>
          )}

          {(standingsEnabled || stageMode === "single" || stageTab === "playoffs") && (
            <Text style={styles.sectionTitle}>Matches</Text>
          )}

          <View style={styles.listWrap}>
            {matchesHook.loading && !matchesHook.data ? (
              <LoadingInCard text="正在加载赛事比赛..." />
            ) : matchesHook.error ? (
              <CardText text="赛事比赛加载失败" />
            ) : activeStageMatches.length === 0 ? (
              <CardText text="暂无比赛" />
            ) : (
              activeStageMatches.map((item, index) => {
                const completed = item.status === "completed";
                const detail = matchMetaHook.data?.[item.match_id] || detailCacheRef.current[item.match_id] || null;
                const team1 = mergeEventTeamWithDetail(item.teams?.[0], detail?.teams || []);
                const team2 = mergeEventTeamWithDetail(item.teams?.[1], detail?.teams || []);
                return (
                  <MatchRow
                    key={`${item.match_id}-${index}`}
                    team1={team1}
                    team2={team2}
                    boText={displayBo(item, detail)}
                    rightTop={completed ? scoreText(team1, team2) : matchStatusText(item.status)}
                    rightBottom={formatDateTimeFromParts(item.date, item.time)}
                    topVariant={completed ? "score" : "default"}
                    alt={index % 2 === 1}
                    onPress={() => navigation.navigate("MatchDetail", { matchId: item.match_id })}
                  />
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function StandingsRow({
  row,
  index,
  total,
  stageTab,
}: {
  row: TeamStandingRow;
  index: number;
  total: number;
  stageTab: StageTab;
}) {
  const eliminationCount = stageTab === "swiss" ? Math.min(4, total) : Math.min(2, total);
  const isEliminated = index >= total - eliminationCount;

  return (
    <View style={[styles.tableRow, isEliminated ? styles.tableRowRed : styles.tableRowGreen]}>
      <View style={styles.tableTeam}>
        <LogoSquare uri={row.logoUri || HOME_IMAGE_URLS.defaultLogo} size={44} borderRadius={8} />
        <Text style={styles.tableTeamName}>{row.teamShort || row.teamName}</Text>
      </View>
      <Text style={styles.tableStat}>{`${row.seriesWin}-${row.seriesLoss}`}</Text>
      <Text style={styles.tableStat}>{`${row.mapWin}/${row.mapLoss}`}</Text>
      <Text style={styles.tableStat}>{`${row.roundWin}/${row.roundLoss}`}</Text>
      <Text style={styles.tableStat}>{row.roundDiff > 0 ? `+${row.roundDiff}` : `${row.roundDiff}`}</Text>
    </View>
  );
}

function MatchRow({
  team1,
  team2,
  boText,
  rightTop,
  rightBottom,
  topVariant = "default",
  alt,
  onPress,
}: {
  team1?: MatchTeam;
  team2?: MatchTeam;
  boText: string;
  rightTop: string;
  rightBottom: string;
  topVariant?: "default" | "score";
  alt?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.matchRow, alt && styles.matchRowAlt]}>
      <View style={styles.rowLeft}>
        <View style={styles.teamLine}>
          <LogoSquare uri={teamLogo(team1) || HOME_IMAGE_URLS.defaultLogo} />
          <Text style={styles.teamLineText}>{team1?.name || "-"}</Text>
        </View>
        <View style={styles.teamLine}>
          <LogoSquare uri={teamLogo(team2) || HOME_IMAGE_URLS.defaultLogo} />
          <Text style={styles.teamLineText}>{team2?.name || "-"}</Text>
        </View>
      </View>
      <Text style={styles.rowBo}>{boText}</Text>
      <View style={styles.rowRight}>
        <Text style={topVariant === "score" ? styles.rowScore : styles.rowTopText}>{rightTop}</Text>
        <Text numberOfLines={1} style={styles.rowDate}>
          {rightBottom}
        </Text>
      </View>
    </Pressable>
  );
}

function CardText({ text }: { text: string }) {
  return (
    <View style={styles.cardCenter}>
      <Text style={styles.cardCenterText}>{text}</Text>
    </View>
  );
}

function LoadingInCard({ text }: { text: string }) {
  return (
    <View style={styles.cardCenter}>
      <ActivityIndicator size="small" color="#111827" />
      <Text style={styles.cardCenterText}>{text}</Text>
    </View>
  );
}

function LogoSquare({
  uri,
  size = 32,
  borderRadius = 6,
}: {
  uri?: string | null;
  size?: number;
  borderRadius?: number;
}) {
  const boxStyle = {
    width: size,
    height: size,
    borderRadius,
    backgroundColor: "transparent",
  } as const;
  if (uri) {
    return <Image source={{ uri }} style={boxStyle} resizeMode="contain" />;
  }
  return <View style={boxStyle} />;
}

function detectStageMode(matches: EventMatchItem[]): StageMode {
  const hasGroup = matches.some((m) => isGroupStage(m));
  const hasSwiss = matches.some((m) => isSwissStage(m));
  const hasPlayoffs = matches.some((m) => isPlayoffsStage(m));
  if (hasGroup && hasPlayoffs) return "group_playoffs";
  if (hasSwiss && hasPlayoffs) return "swiss_playoffs";
  return "single";
}

function stageOptionsForMode(mode: StageMode): Array<{ label: string; value: StageTab }> {
  if (mode === "group_playoffs") {
    return [
      { label: "Group Stage", value: "group" },
      { label: "Playoffs", value: "playoffs" },
    ];
  }
  if (mode === "swiss_playoffs") {
    return [
      { label: "Swiss", value: "swiss" },
      { label: "Playoffs", value: "playoffs" },
    ];
  }
  return [{ label: "Matches", value: "matches" }];
}

function filterMatchesByTab(matches: EventMatchItem[], tab: StageTab): EventMatchItem[] {
  if (tab === "matches") return matches;
  if (tab === "playoffs") {
    const playoffRows = matches.filter((m) => isPlayoffsStage(m));
    return playoffRows.length ? playoffRows : matches;
  }
  if (tab === "group") {
    const groupRows = matches.filter((m) => isGroupStage(m));
    return groupRows.length ? groupRows : matches.filter((m) => !isPlayoffsStage(m));
  }
  const swissRows = matches.filter((m) => isSwissStage(m));
  return swissRows.length ? swissRows : matches.filter((m) => !isPlayoffsStage(m));
}

function isGroupStage(match: EventMatchItem) {
  return stageSource(match).includes("group");
}

function isSwissStage(match: EventMatchItem) {
  return stageSource(match).includes("swiss");
}

function isPlayoffsStage(match: EventMatchItem) {
  const text = stageSource(match);
  if (text.includes("playoff")) return true;
  return /quarter|semi|grand final|upper|lower|final/.test(text);
}

function stageSource(match: EventMatchItem) {
  return `${match.stage || ""} ${match.phase || ""}`.toLowerCase();
}

function isChampionsEvent(info: EventInfoLite): boolean {
  const n = (info.name || "").toLowerCase();
  if (n.includes("challengers")) return false;
  if (n.includes("champions") || n.includes("champs")) return true;
  const regions = (info.regions || []).map((r) => String(r).toLowerCase());
  if (regions.some((r) => r.includes("champions") || r.includes("champs"))) return true;
  return false;
}

/** 冠军赛小组无文案时：若图论上恰为 4 个互不连通的池，则标为 A/B/C/D 四组。 */
function tryChampionsFourGroupSplit(
  teams: string[],
  edges: Array<{ matchId: number; a: string; b: string }>,
  byTeamKey: Record<string, string>,
  byMatchId: Record<number, string>
): SubGroupPlan | null {
  if (teams.length < 8) return null;
  const parent: Record<string, string> = {};
  for (const key of teams) parent[key] = key;
  function find(x: string): string {
    if (!parent[x]) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(a: string, b: string) {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  }
  for (const edge of edges) union(edge.a, edge.b);
  const componentMembers = new Map<string, Set<string>>();
  for (const key of teams) {
    const root = find(key);
    if (!componentMembers.has(root)) componentMembers.set(root, new Set<string>());
    componentMembers.get(root)?.add(key);
  }
  const components = [...componentMembers.values()];
  if (components.length !== 4) return null;

  const letters = ["A", "B", "C", "D"];
  const sorted = components
    .map((set) => ({ set, minKey: [...set].sort()[0] || "" }))
    .sort((a, b) => a.minKey.localeCompare(b.minKey));
  sorted.forEach((row, idx) => {
    const label = letters[idx] || `G${idx}`;
    for (const teamKey of row.set) byTeamKey[teamKey] = label;
  });
  for (const edge of edges) {
    const ta = byTeamKey[edge.a];
    const tb = byTeamKey[edge.b];
    if (ta && tb && ta === tb) byMatchId[edge.matchId] = ta;
  }
  return { tokens: [...letters], byMatchId, byTeamKey };
}

function buildSubGroupPlan(matches: EventMatchItem[], championsMode: boolean): SubGroupPlan {
  const byMatchId: Record<number, string> = {};
  const byTeamKey: Record<string, string> = {};
  const explicit = new Set<string>();
  for (const match of matches) {
    const token = extractSubGroupToken(match, championsMode);
    if (!token) continue;
    byMatchId[match.match_id] = token;
    explicit.add(token);
    const a = teamNodeKey(match.teams?.[0]);
    const b = teamNodeKey(match.teams?.[1]);
    if (a) byTeamKey[a] = token;
    if (b) byTeamKey[b] = token;
  }
  if (explicit.size >= 2) {
    const tokens = [...explicit].sort((a, b) => subGroupSortWeight(a) - subGroupSortWeight(b) || a.localeCompare(b));
    return { tokens, byMatchId, byTeamKey };
  }

  const edges: Array<{ matchId: number; a: string; b: string }> = [];
  const teamSet = new Set<string>();
  for (const match of matches) {
    const a = teamNodeKey(match.teams?.[0]);
    const b = teamNodeKey(match.teams?.[1]);
    if (!a || !b) continue;
    teamSet.add(a);
    teamSet.add(b);
    edges.push({ matchId: match.match_id, a, b });
  }

  // fallback A: 无显式组名时，按“组内对局最大化”做二分（强制 6/6 等分）
  const teams = [...teamSet];

  if (championsMode) {
    const four = tryChampionsFourGroupSplit(teams, edges, byTeamKey, byMatchId);
    if (four) return four;
  }

  const hasEvenGroups = teams.length >= 6 && teams.length % 2 === 0 && teams.length <= 14;
  if (hasEvenGroups && !championsMode) {
    const split = bestBalancedSplit(teams, edges);
    for (const teamKey of split.alpha) byTeamKey[teamKey] = "alpha";
    for (const teamKey of split.omega) byTeamKey[teamKey] = "omega";
    for (const edge of edges) {
      const ta = byTeamKey[edge.a];
      const tb = byTeamKey[edge.b];
      if (!ta || !tb || ta !== tb) continue;
      byMatchId[edge.matchId] = ta;
    }
    return { tokens: ["alpha", "omega"], byMatchId, byTeamKey };
  }

  // fallback B: 再退化为连通分量（旧策略，联赛 α/Ω；冠军赛不在此做二分）
  if (!championsMode) {
    const parent: Record<string, string> = {};
    for (const key of teams) parent[key] = key;
    function find(x: string): string {
      if (!parent[x]) parent[x] = x;
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    }
    function union(a: string, b: string) {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pb] = pa;
    }
    for (const edge of edges) union(edge.a, edge.b);
    const componentMembers = new Map<string, Set<string>>();
    for (const key of teams) {
      const root = find(key);
      if (!componentMembers.has(root)) componentMembers.set(root, new Set<string>());
      componentMembers.get(root)?.add(key);
    }
    const components = [...componentMembers.entries()].sort((a, b) => b[1].size - a[1].size);
    if (components.length >= 2) {
      const alphaRoot = components[0][0];
      const omegaRoot = components[1][0];
      for (const [teamKey] of Object.entries(parent)) {
        const root = find(teamKey);
        if (root === alphaRoot) byTeamKey[teamKey] = "alpha";
        if (root === omegaRoot) byTeamKey[teamKey] = "omega";
      }
      for (const edge of edges) {
        const ta = byTeamKey[edge.a];
        const tb = byTeamKey[edge.b];
        if (ta && tb && ta === tb) byMatchId[edge.matchId] = ta;
      }
    }
  }
  const tokens = [...new Set(Object.values(byTeamKey))].sort(
    (a, b) => subGroupSortWeight(a) - subGroupSortWeight(b) || a.localeCompare(b)
  );
  return { tokens, byMatchId, byTeamKey };
}

function bestBalancedSplit(teams: string[], edges: Array<{ a: string; b: string }>) {
  const n = teams.length;
  const target = Math.floor(n / 2);
  const first = teams[0];
  let bestScore = -1;
  let bestMask = 0;

  function score(mask: number) {
    let s = 0;
    for (const edge of edges) {
      const ia = teams.indexOf(edge.a);
      const ib = teams.indexOf(edge.b);
      if (ia < 0 || ib < 0) continue;
      const inA = ((mask >> ia) & 1) === 1;
      const inB = ((mask >> ib) & 1) === 1;
      if (inA === inB) s += 1;
    }
    return s;
  }

  const firstIndex = teams.indexOf(first);
  const upper = 1 << n;
  for (let mask = 0; mask < upper; mask += 1) {
    if (((mask >> firstIndex) & 1) !== 1) continue;
    if (bitCount(mask) !== target) continue;
    const s = score(mask);
    if (s > bestScore) {
      bestScore = s;
      bestMask = mask;
    }
  }

  const alpha: string[] = [];
  const omega: string[] = [];
  for (let i = 0; i < n; i += 1) {
    if (((bestMask >> i) & 1) === 1) alpha.push(teams[i]);
    else omega.push(teams[i]);
  }
  return { alpha, omega };
}

function bitCount(n: number) {
  let x = n;
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}

function subGroupSortWeight(token: string) {
  const t = token.toLowerCase();
  if (t === "a") return 1;
  if (t === "b") return 2;
  if (t === "c") return 3;
  if (t === "d") return 4;
  if (t === "alpha") return 10;
  if (t === "omega") return 11;
  return 50;
}

function extractSubGroupToken(match: EventMatchItem, championsMode: boolean): string | null {
  const raw = `${match.stage || ""} ${match.phase || ""}`;
  const src = raw.toLowerCase();

  if (championsMode) {
    let m = raw.match(/\bgroup\s*([ABCD])\b/i);
    if (m?.[1]) return m[1].toUpperCase();
    m = raw.match(/\b([ABCD])\s*组\b/);
    if (m?.[1]) return m[1].toUpperCase();
    m = raw.match(/\(([ABCD])\)/i);
    if (m?.[1]) return m[1].toUpperCase();
    m = raw.match(/\b([ABCD])\b(?=\s*(?:vs|v\.?)\s)/i);
    if (m?.[1]) return m[1].toUpperCase();
  } else {
    if (/alpha/i.test(raw)) return "alpha";
    if (/omega/i.test(raw)) return "omega";
  }

  const bracket = raw.match(/\(([A-Za-z0-9]+)\)/);
  if (bracket?.[1]) return normalizeSubGroupToken(bracket[1], championsMode);
  const suffix = raw.match(/\bgroup\s+([A-Za-z0-9]+)\b/i);
  if (suffix?.[1] && suffix[1].toLowerCase() !== "stage") {
    return normalizeSubGroupToken(suffix[1], championsMode);
  }
  if (!championsMode) {
    if (/alpha/i.test(src)) return "alpha";
    if (/omega/i.test(src)) return "omega";
  }
  return null;
}

function normalizeSubGroupToken(raw: string, championsMode: boolean) {
  const token = (raw || "").trim().toLowerCase();
  if (!token) return null;
  if (championsMode) {
    if (/^[abcd]$/.test(token)) return token.toUpperCase();
    if (token === "alpha") return "ALPHA";
    if (token === "omega") return "OMEGA";
    return token.replace(/\s+/g, "").toUpperCase();
  }
  if (token === "alpha" || token === "a" || token === "b") return "alpha";
  if (token === "omega" || token === "c" || token === "d") return "omega";
  return token.toUpperCase();
}

function subGroupLabel(token: string) {
  const t = token.toLowerCase();
  if (t === "alpha") return "α";
  if (t === "omega") return "Ω";
  if (t === "a" || t === "b" || t === "c" || t === "d") return `${t.toUpperCase()}组`;
  return token;
}

function buildTeamStandings(
  matches: EventMatchItem[],
  detailsByMatchId: Record<number, MatchDetailResponse | null>
): TeamStandingRow[] {
  const teamMap = new Map<string, TeamStandingRow>();
  const headToHead = new Map<string, Record<string, number>>();
  const metaById = new Map<number, { logoUri?: string | null; short?: string }>();
  const metaByName = new Map<string, { logoUri?: string | null; short?: string }>();

  for (const detail of Object.values(detailsByMatchId)) {
    const teams = detail?.teams || [];
    for (const team of teams) {
      const name = (team?.name || "").trim();
      const short = pickTeamShort(team, name);
      const logoUri = normalizeImageUrl(team?.logo_url || null);
      if (typeof team?.id === "number") {
        const prev = metaById.get(team.id) || {};
        metaById.set(team.id, { logoUri: prev.logoUri || logoUri, short: prev.short || short });
      }
      if (name) {
        const nameKey = name.toLowerCase();
        const prev = metaByName.get(nameKey) || {};
        metaByName.set(nameKey, { logoUri: prev.logoUri || logoUri, short: prev.short || short });
      }
    }
  }

  function ensureTeam(team?: MatchTeam): TeamStandingRow | null {
    if (!team) return null;
    const key = teamKey(team);
    if (!key) return null;
    const teamName = (team.name || `Team ${team.id || ""}`).trim();
    const metaByTeamId = typeof team.id === "number" ? metaById.get(team.id) : null;
    const metaByTeamName = teamName ? metaByName.get(teamName.toLowerCase()) : null;
    const logoUri = normalizeImageUrl(teamLogo(team)) || metaByTeamId?.logoUri || metaByTeamName?.logoUri || null;
    const strictShort = metaByTeamId?.short || metaByTeamName?.short || "";
    const teamShort = strictShort || pickTeamShort(team, teamName) || teamName;

    if (!teamMap.has(key)) {
      teamMap.set(key, {
        key,
        teamId: team.id,
        teamName,
        teamShort,
        logoUri,
        seriesWin: 0,
        seriesLoss: 0,
        mapWin: 0,
        mapLoss: 0,
        roundWin: 0,
        roundLoss: 0,
        roundDiff: 0,
      });
    }
    const row = teamMap.get(key) || null;
    if (row) {
      if (!row.logoUri && logoUri) row.logoUri = logoUri;
      if (strictShort) row.teamShort = strictShort;
      else if ((!row.teamShort || row.teamShort === row.teamName) && teamShort) row.teamShort = teamShort;
    }
    return row;
  }

  for (const match of matches) {
    ensureTeam(match.teams?.[0]);
    ensureTeam(match.teams?.[1]);
  }

  for (const match of matches) {
    if (match.status !== "completed") continue;
    const t1 = ensureTeam(match.teams?.[0]);
    const t2 = ensureTeam(match.teams?.[1]);
    if (!t1 || !t2) continue;

    const s1 = asNumber(match.teams?.[0]?.score);
    const s2 = asNumber(match.teams?.[1]?.score);
    if (s1 !== null && s2 !== null && s1 !== s2) {
      const winner = s1 > s2 ? t1 : t2;
      const loser = winner === t1 ? t2 : t1;
      winner.seriesWin += 1;
      loser.seriesLoss += 1;
      addHeadToHead(headToHead, t1.key, t2.key, winner.key);
    }

    const detail = detailsByMatchId[match.match_id];
    if (detail?.maps?.length) {
      for (const map of detail.maps) {
        const mapTeams = map.teams as MatchMapTeamScore[] | null | undefined;
        if (!mapTeams || mapTeams.length < 2) continue;
        const mt1 = mapTeams[0];
        const mt2 = mapTeams[1];
        const rt1 = resolveStandingByMapTeam(mt1, t1, t2, teamMap);
        const rt2 = resolveStandingByMapTeam(mt2, t1, t2, teamMap);
        if (!rt1 || !rt2) continue;

        const ms1 = asNumber(mt1.score);
        const ms2 = asNumber(mt2.score);
        if (ms1 !== null && ms2 !== null) {
          rt1.roundWin += ms1;
          rt1.roundLoss += ms2;
          rt2.roundWin += ms2;
          rt2.roundLoss += ms1;
          if (ms1 > ms2) {
            rt1.mapWin += 1;
            rt2.mapLoss += 1;
          } else if (ms2 > ms1) {
            rt2.mapWin += 1;
            rt1.mapLoss += 1;
          }
        }
      }
    } else if (s1 !== null && s2 !== null) {
      t1.mapWin += s1;
      t1.mapLoss += s2;
      t2.mapWin += s2;
      t2.mapLoss += s1;
    }
  }

  const rows = [...teamMap.values()];
  for (const row of rows) {
    row.roundDiff = row.roundWin - row.roundLoss;
  }

  rows.sort((a, b) => {
    if (a.seriesWin !== b.seriesWin) return b.seriesWin - a.seriesWin;
    if (a.seriesLoss !== b.seriesLoss) return a.seriesLoss - b.seriesLoss;
    const h2h = compareHeadToHead(headToHead, a.key, b.key);
    if (h2h !== 0) return h2h;
    return a.teamName.localeCompare(b.teamName, "en", { sensitivity: "base" });
  });
  return rows;
}

function resolveStandingByMapTeam(
  mapTeam: MatchMapTeamScore | undefined,
  fallbackA: TeamStandingRow,
  fallbackB: TeamStandingRow,
  map: Map<string, TeamStandingRow>
) {
  if (!mapTeam) return null;
  if (typeof mapTeam.id === "number") {
    const key = `id:${mapTeam.id}`;
    const byId = map.get(key);
    if (byId) return byId;
  }
  const mapName = (mapTeam.name || "").trim().toLowerCase();
  if (mapName && mapName === fallbackA.teamName.trim().toLowerCase()) return fallbackA;
  if (mapName && mapName === fallbackB.teamName.trim().toLowerCase()) return fallbackB;
  const genericKey = mapTeam.name ? `name:${mapName}` : "";
  return genericKey ? map.get(genericKey) || null : null;
}

function addHeadToHead(
  map: Map<string, Record<string, number>>,
  teamA: string,
  teamB: string,
  winner: string
) {
  const pair = [teamA, teamB].sort().join("|");
  if (!map.has(pair)) {
    map.set(pair, { [teamA]: 0, [teamB]: 0 });
  }
  const row = map.get(pair);
  if (!row) return;
  row[winner] = (row[winner] || 0) + 1;
}

function compareHeadToHead(map: Map<string, Record<string, number>>, teamA: string, teamB: string) {
  const pair = [teamA, teamB].sort().join("|");
  const row = map.get(pair);
  if (!row) return 0;
  const a = row[teamA] || 0;
  const b = row[teamB] || 0;
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function teamKey(team?: MatchTeam | MatchMapTeamScore) {
  if (!team) return "";
  if (typeof team.id === "number") return `id:${team.id}`;
  const name = (team.name || "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

function teamNodeKey(team?: MatchTeam) {
  if (!team) return "";
  if (typeof team.id === "number") return `id:${team.id}`;
  const name = (team.name || "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

function eventDateText(info: EventInfoLite) {
  if (info.date_text) return info.date_text;
  const s = info.start_date || "-";
  const e = info.end_date || "-";
  return `${s} - ${e}`;
}

async function ensureMatchDetails(ids: number[], cache: Record<number, MatchDetailResponse | null>) {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  const pending = unique.filter((id) => cache[id] === undefined);
  if (!pending.length) return;

  await Promise.all(
    pending.map(async (matchId) => {
      if (MATCH_DETAIL_CACHE[matchId] !== undefined) {
        cache[matchId] = MATCH_DETAIL_CACHE[matchId];
        return;
      }
      const detail = await loadMatchDetailCached(matchId);
      cache[matchId] = detail;
    })
  );
}

async function loadMatchDetailCached(matchId: number): Promise<MatchDetailResponse | null> {
  if (MATCH_DETAIL_CACHE[matchId] !== undefined) {
    return MATCH_DETAIL_CACHE[matchId];
  }
  if (!MATCH_DETAIL_INFLIGHT[matchId]) {
    MATCH_DETAIL_INFLIGHT[matchId] = getMatchDetail(matchId)
      .then((detail) => detail)
      .catch(() => null)
      .then((detail) => {
        MATCH_DETAIL_CACHE[matchId] = detail;
        delete MATCH_DETAIL_INFLIGHT[matchId];
        return detail;
      });
  }
  return MATCH_DETAIL_INFLIGHT[matchId];
}

function mergeEventTeamWithDetail(team: MatchTeam | undefined, detailTeams: MatchDetailTeam[]) {
  if (!team) return team;
  const matchById = typeof team.id === "number" ? detailTeams.find((t) => t?.id === team.id) : undefined;
  const matchByName = !matchById
    ? detailTeams.find((t) => (t?.name || "").trim().toLowerCase() === (team.name || "").trim().toLowerCase())
    : undefined;
  const detailTeam = matchById || matchByName;
  if (!detailTeam) return team;
  const next: MatchTeam & { logo_url?: string | null; tag?: string | null; short?: string | null } = {
    ...team,
    logo: team.logo || detailTeam.logo_url || undefined,
    logo_url: detailTeam.logo_url || undefined,
    tag: detailTeam.tag || undefined,
    short: detailTeam.short || undefined,
  };
  return next;
}

function extractBo(text?: string) {
  const m = (text || "").toUpperCase().match(/BO\s*([1-9])/);
  return m?.[1] ? `BO ${m[1]}` : "BO ?";
}

function displayBo(match: EventMatchItem, detail: MatchDetailResponse | null) {
  const fromDetail = formatSeries((detail?.info?.best_of as string | undefined) || undefined);
  if (fromDetail !== "BO ?") return fromDetail;
  const fromPhase = extractBo(match.phase);
  if (fromPhase !== "BO ?") return fromPhase;
  return inferBoByPhase(match);
}

function inferBoByPhase(match: EventMatchItem) {
  const text = `${match.stage || ""} ${match.phase || ""}`.toLowerCase();
  if (/grand final|lower final|upper final|final/.test(text)) return "BO 5";
  return "BO 3";
}

function formatSeries(series?: string) {
  if (!series) return "BO ?";
  const text = String(series).toUpperCase().replace(/\s+/g, " ").trim();
  const match = text.match(/BO\s*([1-9])/);
  if (match?.[1]) return `BO ${match[1]}`;
  return "BO ?";
}

function formatDateTimeFromParts(date?: string, time?: string) {
  if (!date) return "-";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    const dateText = String(date).trim();
    const timeText = normalizeTimeText(time);
    return `${dateText} ${timeText}`.trim();
  }
  const month = parsed.toLocaleString("en-US", { month: "short" });
  const day = parsed.getDate();
  return `${month} ${day} ${normalizeTimeText(time)}`;
}

function normalizeTimeText(time?: string) {
  if (!time) return "--:--";
  const src = String(time).trim();
  const raw = src.match(/(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?/);
  if (!raw) return src.slice(0, 5);
  let hh = Number(raw[1]);
  const mm = raw[2];
  const ampm = (raw[3] || "").toUpperCase();
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${mm}`;
}

function scoreText(team1?: MatchTeam, team2?: MatchTeam) {
  const a = team1?.score;
  const b = team2?.score;
  if (a === undefined || a === null || b === undefined || b === null) return "-";
  return `${a} : ${b}`;
}

function matchStatusText(status?: string) {
  const raw = (status || "").toLowerCase();
  if (raw === "ongoing") return "LIVE";
  if (raw === "upcoming") return "UPCOMING";
  return raw ? raw.toUpperCase() : "-";
}

function teamLogo(team?: MatchTeam) {
  if (!team) return null;
  const anyTeam = team as MatchTeam & { logo_url?: string | null; image_url?: string | null };
  const raw = anyTeam.logo || anyTeam.logo_url || anyTeam.image_url;
  return normalizeImageUrl(raw || null);
}

function normalizeImageUrl(raw?: string | null) {
  if (!raw) return null;
  const url = String(raw).trim();
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function pickTeamShort(
  team: { tag?: string | null; short?: string | null; name?: string | null } | null | undefined,
  fallbackName = ""
) {
  const anyTeam = team || undefined;
  const tag = (anyTeam?.tag || anyTeam?.short || "").trim();
  if (tag) return tag.toUpperCase();
  const name = (anyTeam?.name || fallbackName || "").trim();
  if (!name) return "";
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }
  return name.length > 4 ? name.slice(0, 4).toUpperCase() : name.toUpperCase();
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#efefef",
  },
  centerFull: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    color: "#4b5563",
    fontSize: 13,
    marginBottom: 8,
  },
  retryBtn: {
    borderRadius: 10,
    backgroundColor: "#d7d7d7",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryBtnText: {
    color: "#111827",
    fontWeight: "700",
    fontSize: 12,
  },
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  headerCard: {
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 14,
  },
  headerIcon: {
    width: 84,
    height: 84,
    borderRadius: 12,
    marginBottom: 8,
  },
  headerIconFallback: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: "#bdbdbd",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 40 / 2,
    lineHeight: 48 / 2,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  headerDate: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  stageToggleWrap: {
    alignSelf: "center",
    marginTop: 14,
    flexDirection: "row",
    backgroundColor: "#d7d7d7",
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  stageToggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  stageToggleBtnActive: {
    backgroundColor: "#8f8f8f",
  },
  stageToggleText: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
  },
  stageToggleTextActive: {
    color: "#111827",
    fontWeight: "800",
  },
  subGroupWrap: {
    marginTop: 10,
    flexDirection: "row",
    gap: 6,
    alignSelf: "flex-start",
  },
  subGroupBtn: {
    minWidth: 34,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#d7d7d7",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  subGroupBtnActive: {
    backgroundColor: "#9f9f9f",
  },
  subGroupText: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "700",
  },
  subGroupTextActive: {
    fontWeight: "800",
  },
  tableCard: {
    marginTop: 10,
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
  },
  tableRow: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
  },
  tableRowGreen: {
    backgroundColor: "#b8edb3",
  },
  tableRowRed: {
    backgroundColor: "#efc1c1",
  },
  tableTeam: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tableTeamLogo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#b8b8b8",
  },
  tableTeamName: {
    color: "#111827",
    fontWeight: "700",
    fontSize: 17 / 1.6,
    maxWidth: 102,
  },
  tableStat: {
    width: 58,
    textAlign: "right",
    color: "#111827",
    fontWeight: "800",
    fontSize: 13,
  },
  sectionTitle: {
    marginTop: 14,
    marginBottom: 10,
    fontSize: 36 / 2,
    fontWeight: "800",
    color: "#111827",
  },
  listWrap: {
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
  },
  cardCenter: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  cardCenterText: {
    color: "#4b5563",
    fontSize: 13,
    textAlign: "center",
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  matchRowAlt: {
    backgroundColor: "#cdcdcd",
  },
  rowLeft: {
    flex: 1,
    gap: 5,
  },
  teamLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  teamLineText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "600",
    maxWidth: 110,
  },
  rowBo: {
    width: 64,
    textAlign: "center",
    fontWeight: "800",
    color: "#111827",
  },
  rowRight: {
    width: 86,
    alignItems: "flex-end",
    gap: 2,
  },
  rowTopText: {
    color: "#111827",
    fontWeight: "700",
  },
  rowScore: {
    color: "#111827",
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 18,
  },
  rowDate: {
    color: "#4b5563",
    fontWeight: "700",
    fontSize: 12,
  },
});

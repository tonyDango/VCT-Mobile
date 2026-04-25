import { RouteProp, useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MatchDetailResponse, MatchDetailTeam, MatchMapStats, PlayerStatsRow } from "../api/types";
import { getMatchDetail, getPlayerBasic } from "../api/vlrApi";
import { EmptyState, ErrorState, LoadingState, ScreenContainer } from "../components/Common";
import { getPlayerAvatarSource } from "../config/playerAvatars";
import { useAsyncData } from "../hooks/useAsyncData";
import { RootStackParamList } from "../navigation/types";

type MatchDetailRoute = RouteProp<RootStackParamList, "MatchDetail">;
type MatchDetailNavigation = NativeStackNavigationProp<RootStackParamList>;
type SortKey = "r" | "acs" | "kda" | "kd_diff";
const COL = {
  player: 90,
  agent: 48,
  r: 28,
  acs: 34,
  kda: 56,
  diff: 30,
};
const MATCH_PLAYER_AVATAR_CACHE: Record<number, string | null> = {};
const MATCH_PLAYER_AVATAR_INFLIGHT: Record<number, Promise<string | null>> = {};

/** 总览/上游里常见的队名缩写与详情 `teams` 不一致时的等价写法（小写无空格 key） */
const TEAM_SHORT_CANONICAL: Record<string, string> = {
  mib: "mibr",
  mibr: "mibr",
  skt: "t1",
  skt1: "t1",
  sktt1: "t1",
  sktelecomt1: "t1",
  t1: "t1",
};

function normalizeTeamToken(raw?: string | null) {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function canonicalTeamShort(raw?: string | null) {
  const t = normalizeTeamToken(raw);
  if (!t) return "";
  return TEAM_SHORT_CANONICAL[t] || t;
}

function teamMatchTokens(team: MatchDetailTeam): string[] {
  const raw = [team.short, team.tag, team.name];
  const set = new Set<string>();
  for (const part of raw) {
    const n = normalizeTeamToken(part);
    if (n) set.add(n);
    const c = canonicalTeamShort(part);
    if (c) set.add(c);
  }
  return [...set];
}

/** All map 等聚合里 team_id / team_short 可能与详情略不一致；绝不因筛空而回退显示十人。 */
function playerBelongsToTeam(p: PlayerStatsRow, team: MatchDetailTeam): boolean {
  const pid = typeof p.team_id === "number" ? p.team_id : Number(p.team_id);
  if (Number.isFinite(pid) && typeof team.id === "number" && team.id > 0 && pid === team.id) {
    return true;
  }
  const pCanon = canonicalTeamShort(p.team_short);
  if (!pCanon) return false;
  for (const tok of teamMatchTokens(team)) {
    const tCanon = canonicalTeamShort(tok) || tok;
    if (tCanon && tCanon === pCanon) return true;
  }
  return false;
}

export function MatchDetailScreen() {
  const route = useRoute<MatchDetailRoute>();
  const navigation = useNavigation<MatchDetailNavigation>();
  const { matchId } = route.params;

  const { data, loading, error, reload } = useAsyncData(() => getMatchDetail(matchId), [matchId]);
  const [selectedMapKey, setSelectedMapKey] = useState("all");
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("r");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [agentIconMap, setAgentIconMap] = useState<Record<string, string>>({});
  const [playerAvatarMap, setPlayerAvatarMap] = useState<Record<number, string | null>>({});
  const hasMountedFocus = useRef(false);

  const detail = (data as MatchDetailResponse | null) || null;
  const mapOptions = detail ? buildMapOptions(detail) : [{ key: "all", label: "All Maps", data: undefined }];
  const selectedMap = mapOptions.find((m) => m.key === selectedMapKey) || mapOptions[0];
  const allTeams = ((detail?.teams || []) as MatchDetailTeam[]) || [];
  const currentMapTeams = selectedMap.data?.teams || null;

  useEffect(() => {
    if (!selectedTeamId && allTeams.length) {
      setSelectedTeamId(allTeams[0].id || null);
    }
  }, [allTeams, selectedTeamId]);

  useEffect(() => {
    let active = true;
    async function loadAgents() {
      try {
        const res = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
        const json = await res.json();
        if (!active || !json?.data) return;
        const map: Record<string, string> = {};
        for (const a of json.data) {
          const name = (a.displayName || "").toLowerCase();
          const icon = a.displayIconSmall || a.displayIcon;
          if (name && icon) {
            map[name] = icon;
          }
        }
        setAgentIconMap(map);
      } catch {
        setAgentIconMap({});
      }
    }
    loadAgents();
    return () => {
      active = false;
    };
  }, []);

  const selectedTeam = allTeams.find((t) => t.id === selectedTeamId) || allTeams[0] || null;
  const sortedPlayers = useMemo(() => {
    const players = (selectedMap.data?.players || []) as PlayerStatsRow[];
    if (!selectedTeam) {
      return sortPlayers(players, sortKey, sortOrder);
    }
    const filtered = players.filter((p) => playerBelongsToTeam(p, selectedTeam));
    return sortPlayers(filtered, sortKey, sortOrder);
  }, [selectedMap, selectedTeam, sortKey, sortOrder]);
  const visiblePlayerIds = useMemo(() => {
    const ids: number[] = [];
    const used = new Set<number>();
    for (const row of sortedPlayers) {
      const id = normalizePlayerId(row.player_id);
      if (!id || used.has(id)) continue;
      used.add(id);
      ids.push(id);
    }
    return ids;
  }, [sortedPlayers]);
  const visiblePlayerIdsKey = visiblePlayerIds.join(",");

  useEffect(() => {
    if (!visiblePlayerIds.length) return;
    let alive = true;

    async function loadAvatars() {
      const missing = visiblePlayerIds.filter((id) => MATCH_PLAYER_AVATAR_CACHE[id] === undefined);
      if (missing.length) {
        await Promise.all(
          missing.map(async (id) => {
            MATCH_PLAYER_AVATAR_CACHE[id] = await loadMatchPlayerAvatarCached(id);
          })
        );
      }
      if (!alive) return;
      setPlayerAvatarMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of visiblePlayerIds) {
          const avatar = MATCH_PLAYER_AVATAR_CACHE[id] ?? null;
          if (next[id] !== avatar) {
            next[id] = avatar;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    loadAvatars();
    return () => {
      alive = false;
    };
  }, [visiblePlayerIdsKey]);

  useFocusEffect(
    useCallback(() => {
      if (!hasMountedFocus.current) {
        hasMountedFocus.current = true;
        return;
      }
      reload();
    }, [reload])
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!detail) return <EmptyState message="未找到比赛详情" />;

  const [scoreA, scoreB] = detail.info?.score || [null, null];
  const showTopScore = typeof scoreA === "number" && typeof scoreB === "number";
  const phaseLines = splitPhaseLines(detail.info?.event_phase, detail.info?.status_note);

  function onSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(nextKey);
      setSortOrder("desc");
    }
  }

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.topCard}>
          <View style={styles.eventImageWrap}>
            {detail.event_image_url ? (
              <Image source={{ uri: detail.event_image_url }} style={styles.eventImage} resizeMode="contain" />
            ) : (
              <View style={styles.eventImage} />
            )}
          </View>
          <View style={styles.topRow}>
            <View style={styles.topTeam}>
              <Text style={styles.topTeamName}>{abbr(allTeams[0])}</Text>
              <TeamLogo team={allTeams[0]} />
            </View>
            <Text style={styles.topScore}>{showTopScore ? `${scoreA} : ${scoreB}` : "-"}</Text>
            <View style={[styles.topTeam, styles.topTeamRight]}>
              <TeamLogo team={allTeams[1]} />
              <Text style={styles.topTeamName}>{abbr(allTeams[1])}</Text>
            </View>
          </View>
          <Text style={styles.topBo}>{normalizeBo(detail.info?.best_of)}</Text>
          <Text style={styles.topEventName}>{detail.info?.event || "-"}</Text>
          <Text style={styles.topEventPhase}>{phaseLines[0]}</Text>
          {phaseLines[1] ? <Text style={styles.topEventPhase}>{phaseLines[1]}</Text> : null}
          <Text style={styles.topTime}>{formatTopTime(detail.info?.date, detail.info?.time)}</Text>
        </View>

        <View style={styles.bottomCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mapTabs}>
            {mapOptions.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => setSelectedMapKey(m.key)}
                style={[styles.mapTab, m.key === selectedMap.key && styles.mapTabActive]}
              >
                <Text style={[styles.mapTabText, m.key === selectedMap.key && styles.mapTabTextActive]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {selectedMap.key !== "all" && currentMapTeams ? (
            <View style={styles.mapScoreRow}>
              <Pressable onPress={() => setSelectedTeamId(currentMapTeams[0]?.id || null)}>
                <TeamLogo team={resolveTeam(currentMapTeams[0], allTeams)} size={54} round={10} />
              </Pressable>
              <Text style={styles.mapScore}>
                <Text style={styles.scoreWin}>{currentMapTeams[0]?.score ?? "-"}</Text>
                {" : "}
                <Text style={styles.scoreLose}>{currentMapTeams[1]?.score ?? "-"}</Text>
              </Text>
              <Pressable onPress={() => setSelectedTeamId(currentMapTeams[1]?.id || null)}>
                <TeamLogo team={resolveTeam(currentMapTeams[1], allTeams)} size={54} round={10} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.teamSwitcherRow}>
              {allTeams.map((team, index) => (
                <Pressable
                  key={`switch-${team.id ?? team.short ?? team.tag ?? team.name ?? index}`}
                  onPress={() => setSelectedTeamId(team.id || null)}
                  style={styles.switcherBtn}
                >
                  <TeamLogo team={team} size={42} round={8} />
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.tableWrap}>
            <View style={styles.tableHead}>
              <Text style={[styles.headCell, styles.colPlayerHead]}>Player</Text>
              <Text style={[styles.headCell, styles.colAgentHead]}>Agent</Text>
              <Pressable style={[styles.sortHeadBtn, styles.colR]} onPress={() => onSort("r")}>
                <Text style={styles.headCell}>R</Text>
              </Pressable>
              <Pressable style={[styles.sortHeadBtn, styles.colACS]} onPress={() => onSort("acs")}>
                <Text style={styles.headCell}>ACS</Text>
              </Pressable>
              <Pressable style={[styles.sortHeadBtn, styles.colKDA]} onPress={() => onSort("kda")}>
                <Text style={styles.headCell}>K/D/A</Text>
              </Pressable>
              <Pressable style={[styles.sortHeadBtn, styles.colDiff]} onPress={() => onSort("kd_diff")}>
                <Text style={styles.headCell}>+/-</Text>
              </Pressable>
            </View>

            {sortedPlayers.map((p, idx) => (
              <View key={`${p.player_id || p.name || "p"}-${idx}`} style={styles.playerRow}>
                {(() => {
                  const pid = normalizePlayerId(p.player_id);
                  const hasPid = Boolean(pid);
                  return (
                <Pressable
                  disabled={!hasPid}
                  onPress={() => {
                    if (pid) navigation.navigate("PlayerDetail", { playerId: pid });
                  }}
                  style={({ pressed }) => [
                    styles.playerLeft,
                    styles.colPlayer,
                    hasPid && styles.playerPressable,
                    hasPid && pressed && styles.playerPressed,
                  ]}
                >
                  <PlayerAvatar
                    playerId={p.player_id}
                    playerName={p.name}
                    avatarUri={pid ? playerAvatarMap[pid] : null}
                  />
                  <Text style={styles.playerName} numberOfLines={1}>
                    {p.name}
                  </Text>
                </Pressable>
                  );
                })()}

                <AgentIcons
                  agents={selectedMap.key === "all" ? p.agents || [] : (p.agents || []).slice(0, 1)}
                  iconMap={agentIconMap}
                  style={styles.colAgent}
                />

                <StatBox value={p.r} width={COL.r} />
                <StatBox value={p.acs} width={COL.acs} />
                <StatBox value={formatKda(p)} width={COL.kda} />
                <StatBox value={p.kd_diff} width={COL.diff} positive />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function buildMapOptions(detail: MatchDetailResponse): Array<{ key: string; label: string; data: MatchMapStats | undefined }> {
  const out = [{ key: "all", label: "All Maps", data: detail.total_stats }];
  (detail.maps || []).forEach((m, i) => {
    out.push({ key: `map-${i}`, label: m.map_name || `Map${i + 1}`, data: m });
  });
  return out;
}

function sortPlayers(rows: PlayerStatsRow[], key: SortKey, order: "asc" | "desc") {
  const arr = [...rows];
  arr.sort((a, b) => {
    const va = key === "kda" ? kdaSortValue(a) : numVal(a[key]);
    const vb = key === "kda" ? kdaSortValue(b) : numVal(b[key]);
    if (va === vb) return 0;
    return order === "asc" ? va - vb : vb - va;
  });
  return arr;
}

function kdaSortValue(row: PlayerStatsRow) {
  const k = numVal(row.k);
  const d = Math.max(1, numVal(row.d));
  const a = numVal(row.a);
  return (k + a) / d;
}

function formatKda(row: PlayerStatsRow) {
  const k = numInt(row.k);
  const d = numInt(row.d);
  const a = numInt(row.a);
  return `${k}/${d}/${a}`;
}

function numVal(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n)) return n;
  return -999999;
}

function numInt(v: unknown) {
  const n = numVal(v);
  return n === -999999 ? "-" : String(Math.round(n));
}

function TeamLogo({
  team,
  size = 36,
  round = 8,
}: {
  team?: MatchDetailTeam | { logo_url?: string | null };
  size?: number;
  round?: number;
}) {
  if (team?.logo_url) {
    return (
      <Image
        source={{ uri: team.logo_url }}
        style={{ width: size, height: size, borderRadius: round }}
        resizeMode="contain"
      />
    );
  }
  return <View style={{ width: size, height: size, borderRadius: round, backgroundColor: "#c9c9c9" }} />;
}

function resolveTeam(
  fromMap: { id?: number; name?: string; short?: string } | undefined,
  teams: MatchDetailTeam[]
): MatchDetailTeam | undefined {
  if (!fromMap) return undefined;
  if (fromMap.id) {
    const byId = teams.find((t) => t.id === fromMap.id);
    if (byId) return byId;
  }

  const targetShort = (fromMap.short || "").trim().toLowerCase();
  if (targetShort) {
    const byShort = teams.find((t) => (t.short || t.tag || "").trim().toLowerCase() === targetShort);
    if (byShort) return byShort;
  }

  const targetName = (fromMap.name || "").trim().toLowerCase();
  if (targetName) {
    const byName = teams.find((t) => (t.name || "").trim().toLowerCase() === targetName);
    if (byName) return byName;
  }
  return undefined;
}

function normalizePlayerId(playerId?: number) {
  if (typeof playerId !== "number") return null;
  return Number.isFinite(playerId) && playerId > 0 ? playerId : null;
}

async function loadMatchPlayerAvatarCached(playerId: number): Promise<string | null> {
  if (MATCH_PLAYER_AVATAR_CACHE[playerId] !== undefined) return MATCH_PLAYER_AVATAR_CACHE[playerId];
  if (!MATCH_PLAYER_AVATAR_INFLIGHT[playerId]) {
    MATCH_PLAYER_AVATAR_INFLIGHT[playerId] = getPlayerBasic(playerId)
      .then((data) => {
        const avatar = normalizeImageUrl((data?.avatar_url as string | undefined) || null);
        MATCH_PLAYER_AVATAR_CACHE[playerId] = avatar;
        delete MATCH_PLAYER_AVATAR_INFLIGHT[playerId];
        return avatar;
      })
      .catch(() => {
        MATCH_PLAYER_AVATAR_CACHE[playerId] = null;
        delete MATCH_PLAYER_AVATAR_INFLIGHT[playerId];
        return null;
      });
  }
  return MATCH_PLAYER_AVATAR_INFLIGHT[playerId];
}

function normalizeImageUrl(raw?: string | null) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  return text;
}

function PlayerAvatar({
  playerId,
  playerName,
  avatarUri,
}: {
  playerId?: number;
  playerName?: string;
  avatarUri?: string | null;
}) {
  if (avatarUri) {
    return <Image source={{ uri: avatarUri }} style={styles.avatarImage} resizeMode="cover" />;
  }
  const source = getPlayerAvatarSource(playerId, playerName);
  if (source) {
    return <Image source={source} style={styles.avatarImage} resizeMode="cover" />;
  }
  return <View style={styles.avatarDot} />;
}

function normalizeBo(bestOf?: string | null) {
  if (!bestOf) return "BO -";
  const m = bestOf.toUpperCase().match(/BO\s*([1-9])/);
  return m?.[1] ? `BO ${m[1]}` : bestOf.toUpperCase();
}

function formatTopTime(date?: string, time?: string) {
  const dateText = date || "-";
  const timeText = time ? String(time).slice(0, 5) : "--:--";
  return `${dateText}   ${timeText}`;
}

function splitPhaseLines(eventPhase?: string, statusNote?: string): [string, string?] {
  const phase = (eventPhase || "").trim();
  const note = normalizeStatusNoteCountdown((statusNote || "").trim());
  const ignored = /^(completed|upcoming|live|in progress|finished|ongoing|final)$/i;

  if (phase && note && !ignored.test(note) && phase.toLowerCase() !== note.toLowerCase()) {
    return [phase, note];
  }

  const parts = phase.split(/\s*(?:\||-|\/|:)\s*/).filter(Boolean);
  if (parts.length >= 2) {
    return [parts[0], parts.slice(1).join(" - ")];
  }

  return [phase || "-"];
}

function normalizeStatusNoteCountdown(note: string) {
  const text = (note || "").trim();
  if (!text) return "";
  // 常见：`5h 20m` / `5 h 20 m` / `20m`
  const hm = text.match(/^\s*(\d+)\s*h\s*(\d+)\s*m\s*$/i);
  if (hm) {
    const hours = Number(hm[1]);
    const minutes = Number(hm[2]);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      const totalHours = hours + Math.floor(minutes / 60);
      const days = Math.floor(totalHours / 24);
      const hh = totalHours % 24;
      return `${days}d ${hh}h`;
    }
  }
  const hOnly = text.match(/^\s*(\d+)\s*h\s*$/i);
  if (hOnly) {
    const hours = Number(hOnly[1]);
    if (Number.isFinite(hours)) {
      const days = Math.floor(hours / 24);
      const hh = hours % 24;
      return `${days}d ${hh}h`;
    }
  }
  const mOnly = text.match(/^\s*(\d+)\s*m\s*$/i);
  if (mOnly) {
    const minutes = Number(mOnly[1]);
    if (Number.isFinite(minutes)) {
      const totalHours = Math.floor(minutes / 60);
      const days = Math.floor(totalHours / 24);
      const hh = totalHours % 24;
      return `${days}d ${hh}h`;
    }
  }
  return text;
}

function abbr(team?: MatchDetailTeam) {
  if (!team) return "TBD";
  if (team.tag) return team.tag.toUpperCase();
  if (team.short) return team.short.toUpperCase();
  if (team.name) return team.name.slice(0, 3).toUpperCase();
  return "TBD";
}

const styles = StyleSheet.create({
  page: {
    padding: 14,
    paddingBottom: 28,
    gap: 14,
  },
  topCard: {
    backgroundColor: "#d7d7d7",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  eventImageWrap: {
    alignItems: "center",
    marginBottom: 6,
  },
  eventImage: {
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: "transparent",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  topTeam: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topTeamRight: {
    justifyContent: "flex-end",
  },
  topTeamName: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },
  topScore: {
    fontSize: 32,
    fontWeight: "900",
    color: "#111827",
    minWidth: 90,
    textAlign: "center",
  },
  topBo: {
    marginTop: 2,
    textAlign: "center",
    fontWeight: "700",
    color: "#111827",
  },
  topEventName: {
    marginTop: 8,
    textAlign: "center",
    color: "#111827",
    fontSize: 13,
    fontWeight: "800",
  },
  topEventPhase: {
    marginTop: 2,
    textAlign: "center",
    color: "#111827",
    fontSize: 13,
  },
  topTime: {
    marginTop: 8,
    textAlign: "center",
    color: "#111827",
    fontWeight: "700",
  },
  bottomCard: {
    backgroundColor: "#d7d7d7",
    borderRadius: 20,
    padding: 12,
  },
  mapTabs: {
    gap: 8,
  },
  mapTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#ececec",
  },
  mapTabActive: {
    backgroundColor: "#8f8f8f",
  },
  mapTabText: {
    color: "#111827",
    fontWeight: "600",
    fontSize: 12,
  },
  mapTabTextActive: {
    color: "#fff",
  },
  mapScoreRow: {
    marginTop: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mapScore: {
    fontSize: 40,
    fontWeight: "900",
    color: "#111827",
    minWidth: 120,
    textAlign: "center",
  },
  scoreWin: {
    color: "#22a14a",
  },
  scoreLose: {
    color: "#b91c1c",
  },
  teamSwitcherRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  switcherBtn: {
    padding: 4,
    borderRadius: 10,
    backgroundColor: "#ececec",
  },
  tableWrap: {
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    padding: 10,
  },
  tableHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  headCell: {
    textAlign: "center",
    fontSize: 11,
    color: "#6b7280",
    fontWeight: "700",
  },
  sortHeadBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  colPlayer: {
    width: COL.player,
    textAlign: "left",
    paddingLeft: 2,
  },
  colPlayerHead: {
    width: COL.player,
    textAlign: "center",
  },
  colAgentHead: {
    width: COL.agent,
    textAlign: "center",
  },
  colAgent: {
    width: COL.agent,
    alignItems: "center",
    justifyContent: "center",
  },
  colR: {
    width: COL.r,
  },
  colACS: {
    width: COL.acs,
  },
  colKDA: {
    width: COL.kda,
  },
  colDiff: {
    width: COL.diff,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    marginBottom: 8,
  },
  playerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingRight: 2,
  },
  playerPressable: {
    borderRadius: 8,
    paddingVertical: 3,
  },
  playerPressed: {
    opacity: 0.72,
  },
  avatarDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#c4c4c4",
  },
  avatarImage: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#c4c4c4",
  },
  playerName: {
    flex: 1,
    fontWeight: "700",
    fontSize: 12,
    color: "#111827",
  },
  agentList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 1,
    alignItems: "center",
    justifyContent: "center",
    alignContent: "center",
    paddingVertical: 0,
  },
  agentIcon: {
    width: 20,
    height: 20,
    borderRadius: 3,
  },
  agentIconFallback: {
    width: 13,
    height: 13,
    borderRadius: 3,
    backgroundColor: "#c4c4c4",
  },
  statCell: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 1,
  },
  statBox: {
    width: "100%",
    height: 28,
    borderRadius: 4,
    backgroundColor: "#d7d7d7",
    justifyContent: "center",
    alignItems: "center",
  },
  statText: {
    fontWeight: "700",
    fontSize: 10,
    color: "#6b7280",
  },
  statPositive: {
    color: "#1f8c3b",
    fontWeight: "600",
  },
  statNegative: {
    color: "#b91c1c",
    fontWeight: "600",
  },
});

function AgentIcons({
  agents,
  iconMap,
  style,
}: {
  agents: string[];
  iconMap: Record<string, string>;
  style?: object;
}) {
  return (
    <View style={[styles.agentList, style]}>
      {agents.map((name, idx) => {
        const url = iconMap[name.toLowerCase()];
        return url ? (
          <Image key={`${name}-${idx}`} source={{ uri: url }} style={styles.agentIcon} resizeMode="cover" />
        ) : (
          <View key={`${name}-${idx}`} style={styles.agentIconFallback} />
        );
      })}
    </View>
  );
}

function StatBox({
  value,
  width,
  positive = false,
}: {
  value: unknown;
  width: number;
  positive?: boolean;
}) {
  const isKdaText = typeof value === "string" && value.includes("/");
  const n = typeof value === "number" ? value : Number(value);
  const text = isKdaText ? value : Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : "-";
  const isPos = !isKdaText && positive && Number.isFinite(n) && n > 0;
  const isNeg = !isKdaText && positive && Number.isFinite(n) && n < 0;
  return (
    <View style={[styles.statCell, { width }]}>
      <View style={styles.statBox}>
        <Text style={[styles.statText, isPos && styles.statPositive, isNeg && styles.statNegative]}>{text}</Text>
      </View>
    </View>
  );
}

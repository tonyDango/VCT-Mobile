import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { CompositeNavigationProp, useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HomeVctMatchItem, MatchListItem, TeamSelectorRegion } from "../api/types";
import { getHomeVctMatches, getLiveMatches, getTeamDetail, getTeamSelector } from "../api/vlrApi";
import {
  HOME_IMAGE_URLS,
  HOME_REGION_ICON_URLS,
  HOME_SELECTED_TEAM_STORAGE_KEY,
  HOME_TEAM_ABBR_MAP,
} from "../config/homeConfig";
import { ErrorState, LoadingState } from "../components/Common";
import { useAsyncData } from "../hooks/useAsyncData";
import { MainTabParamList, RootStackParamList } from "../navigation/types";

type HomeTab = "upcoming" | "completed";
type HomeNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

type TeamSide = {
  id?: number;
  name?: string;
  tag?: string | null;
  score?: number | null;
  logo?: string | null;
};

type TeamMatch = {
  match_id?: number;
  phase?: string;
  series?: string;
  match_datetime?: string;
  team1?: TeamSide;
  team2?: TeamSide;
};

type TeamInfo = {
  team_id?: number;
  name?: string;
  tag?: string | null;
  logo_url?: string;
};

type TeamDetailPayload = {
  info?: TeamInfo;
  upcoming_matches?: TeamMatch[];
  completed_matches?: TeamMatch[];
};

function asTeamDetail(data: Record<string, unknown> | null): TeamDetailPayload {
  if (!data) return {};
  return {
    info: (data.info as TeamInfo) || {},
    upcoming_matches: (data.upcoming_matches as TeamMatch[]) || [],
    completed_matches: (data.completed_matches as TeamMatch[]) || [],
  };
}

function formatSeries(series?: string) {
  if (!series) return "BO ?";
  const text = series.toUpperCase().replace(/\s+/g, " ").trim();
  const match = text.match(/BO\s*([1-9])/);
  if (match?.[1]) return `BO ${match[1]}`;
  return text;
}

function inferBestOfForTeamMatch(match?: TeamMatch) {
  const direct = formatSeries(match?.series);
  if (direct !== "BO ?" && direct !== (match?.series || "").toUpperCase()) {
    return direct;
  }
  const phaseText = `${match?.phase || ""} ${match?.series || ""}`.toLowerCase();
  if (/\bbo\s*[1-9]\b/.test(phaseText)) {
    const m = phaseText.match(/\bbo\s*([1-9])\b/);
    return m?.[1] ? `BO ${m[1]}` : "BO 3";
  }
  if (/(grand final|lower final|upper final|final)/.test(phaseText)) {
    return "BO 5";
  }
  return "BO 3";
}

function formatDateTime(iso?: string) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${month} ${day}   ${hh}:${mm}`;
}

function formatCountdown(iso?: string) {
  if (!iso) return "-";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "-";
  const diff = target - Date.now();
  if (diff <= 0) return "0d 0h";
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${days}d ${hours}h`;
}

function scoreText(match: TeamMatch) {
  const a = match.team1?.score;
  const b = match.team2?.score;
  if (a === undefined || a === null || b === undefined || b === null) return "-";
  return `${a} : ${b}`;
}

function pickOpponentTeam(match: TeamMatch | undefined, selectedTeamId?: number) {
  if (!match) return undefined;
  const t1 = match.team1;
  const t2 = match.team2;
  if (selectedTeamId && t1?.id === selectedTeamId) return t2;
  if (selectedTeamId && t2?.id === selectedTeamId) return t1;
  return t2 || t1;
}

function normalizeNameKey(name?: string | null) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toTs(iso?: string) {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function pickNextUpcomingMatch(matches: TeamMatch[]) {
  if (!matches.length) return undefined;
  const now = Date.now();
  const safe = matches.filter((m) => {
    const ts = toTs(m.match_datetime);
    if (ts === null) return false;
    return ts >= now - 2 * 60 * 60 * 1000;
  });
  if (!safe.length) return undefined;
  const sorted = [...safe].sort((a, b) => {
    const ta = toTs(a.match_datetime);
    const tb = toTs(b.match_datetime);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });
  return sorted[0];
}

function mergeDateAndTime(dateText?: string, timeText?: string) {
  const d = (dateText || "").trim();
  if (!d) return undefined;
  const t = (timeText || "00:00").trim();
  const normalizedTime = /^\d{1,2}:\d{2}$/.test(t) ? t : "00:00";
  const candidate = new Date(`${d} ${normalizedTime}`);
  if (Number.isNaN(candidate.getTime())) return undefined;
  return candidate.toISOString();
}

function toTeamMatchFromLive(row: MatchListItem): TeamMatch {
  return {
    match_id: row.match_id,
    phase: row.event_phase,
    series: row.event_phase,
    match_datetime: mergeDateAndTime(row.date, row.time),
    team1: {
      id: row.team1?.id,
      name: row.team1?.name,
      tag: row.team1?.tag,
      score: row.team1?.score,
      logo: row.team1?.logo || null,
    },
    team2: {
      id: row.team2?.id,
      name: row.team2?.name,
      tag: row.team2?.tag,
      score: row.team2?.score,
      logo: row.team2?.logo || null,
    },
  };
}

function findLiveMatchForTeam(
  rows: MatchListItem[],
  selectedTeamId?: number | null,
  teamName?: string,
  teamTag?: string | null
) {
  if (!rows.length) return undefined;
  const normalizedTeamName = normalizeNameKey(teamName);
  const normalizedTeamTag = normalizeNameKey(teamTag);

  for (const row of rows) {
    if (selectedTeamId && (row.team1?.id === selectedTeamId || row.team2?.id === selectedTeamId)) {
      return toTeamMatchFromLive(row);
    }
    const aliases = [
      normalizeNameKey(row.team1?.name),
      normalizeNameKey(row.team1?.tag || undefined),
      normalizeNameKey(row.team2?.name),
      normalizeNameKey(row.team2?.tag || undefined),
    ];
    if (
      (normalizedTeamName && aliases.includes(normalizedTeamName)) ||
      (normalizedTeamTag && aliases.includes(normalizedTeamTag))
    ) {
      return toTeamMatchFromLive(row);
    }
  }
  return undefined;
}

function teamLogoUri(team?: { logo?: string | null; logo_url?: string | null; image_url?: string | null }) {
  if (!team) return null;
  const raw = team.logo || team.logo_url || team.image_url;
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  return text;
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

function IconImage({
  uri,
  fallback,
  size = 22,
}: {
  uri?: string;
  fallback: keyof typeof Ionicons.glyphMap;
  size?: number;
}) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 4 }} />;
  }
  return <Ionicons name={fallback} size={size} color="#111827" />;
}

function getTeamAbbr(name?: string, tag?: string | null) {
  if (tag && tag.trim()) return tag.trim().toUpperCase();
  const raw = (name || "").trim();
  if (!raw) return "-";
  const mapped = HOME_TEAM_ABBR_MAP[raw.toLowerCase()];
  if (mapped) return mapped;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("");
  }
  return raw.slice(0, 3).toUpperCase();
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<HomeNav>();
  const [tab, setTab] = useState<HomeTab>("upcoming");
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [storageReady, setStorageReady] = useState(false);
  const hasFocused = useRef(false);

  useEffect(() => {
    async function init() {
      try {
        const raw = await AsyncStorage.getItem(HOME_SELECTED_TEAM_STORAGE_KEY);
        const parsed = raw ? Number.parseInt(raw, 10) : NaN;
        if (raw && Number.isFinite(parsed) && parsed > 0) {
          setSelectedTeamId(parsed);
        } else {
          setSelectedTeamId(null);
          setSelectorVisible(true);
        }
      } catch {
        setSelectedTeamId(null);
        setSelectorVisible(true);
      } finally {
        setStorageReady(true);
      }
    }
    init();
  }, []);

  const selectorHook = useAsyncData(
    () => getTeamSelector(1),
    []
  );
  const teamHook = useAsyncData(
    async () => {
      if (!selectedTeamId) return null;
      return getTeamDetail(selectedTeamId);
    },
    [selectedTeamId]
  );
  const liveHook = useAsyncData(() => getLiveMatches(30), []);
  const upcomingVctHook = useAsyncData(() => getHomeVctMatches("upcoming", 5, 1), []);
  const completedVctHook = useAsyncData(() => getHomeVctMatches("completed", 5, 1), []);

  useEffect(() => {
    const regions = selectorHook.data?.items || [];
    if (!regions.length) return;
    const exists = regions.some((r) => r.region === selectedRegion);
    if (!selectedRegion || !exists) {
      setSelectedRegion(regions[0].region);
    }
  }, [selectorHook.data, selectedRegion]);

  const detail = asTeamDetail(teamHook.data);
  const info = detail.info || {};
  const upcoming = detail.upcoming_matches || [];
  const activeVctHook = tab === "upcoming" ? upcomingVctHook : completedVctHook;
  const vctMatches = (activeVctHook.data?.items || []) as HomeVctMatchItem[];
  const teamTag = (info as { tag?: string | null }).tag;
  const nextMatch = useMemo(() => pickNextUpcomingMatch(upcoming), [upcoming]);
  const liveMatch = useMemo(
    () =>
      findLiveMatchForTeam(
        (liveHook.data?.items || []) as MatchListItem[],
        selectedTeamId,
        info.name,
        teamTag
      ),
    [liveHook.data, selectedTeamId, info.name, teamTag]
  );
  const featuredMatch = liveMatch || nextMatch;
  const opponent = pickOpponentTeam(featuredMatch, (info.team_id as number | undefined));
  const featuredIsLive = !!liveMatch;
  const list = vctMatches;
  const loadedTeamId = Number((info.team_id as number | undefined) || 0);
  const isSwitchingTeam =
    !!selectedTeamId &&
    (teamHook.loading || (loadedTeamId > 0 && loadedTeamId !== selectedTeamId));

  const regionOptions = (selectorHook.data?.items || []) as TeamSelectorRegion[];
  const selectedRegionTeams = useMemo(() => {
    const found = regionOptions.find((r) => r.region === selectedRegion);
    if (found?.teams?.length) return found.teams;
    return regionOptions[0]?.teams || [];
  }, [regionOptions, selectedRegion]);

  useFocusEffect(
    useCallback(() => {
      if (!hasFocused.current) {
        hasFocused.current = true;
        return;
      }
      liveHook.reload();
      if (selectedTeamId) teamHook.reload();
    }, [liveHook.reload, selectedTeamId, teamHook.reload])
  );

  async function onSelectTeam(teamId: number) {
    setSelectedTeamId(teamId);
    setSelectorVisible(false);
    await AsyncStorage.setItem(HOME_SELECTED_TEAM_STORAGE_KEY, String(teamId));
  }

  if (!storageReady) return <LoadingState />;
  if (selectedTeamId && teamHook.loading && !teamHook.data) return <LoadingState />;
  if (teamHook.error) return <ErrorState message={teamHook.error} onRetry={teamHook.reload} />;
  if (activeVctHook.error) return <ErrorState message={activeVctHook.error} onRetry={activeVctHook.reload} />;

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18 }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerIconWrap}>
            <LogoSquare uri={HOME_IMAGE_URLS.topAvatar} size={38} borderRadius={10} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>主队接下来的比赛</Text>
        <Pressable style={styles.switchTeamBtn} onPress={() => setSelectorVisible(true)}>
          <Text style={styles.switchTeamBtnText}>更换主队</Text>
        </Pressable>
        <Pressable
          style={styles.heroCard}
          onPress={() => {
            if (!isSwitchingTeam && featuredMatch?.match_id) {
              navigation.navigate("MatchDetail", { matchId: featuredMatch.match_id });
            }
          }}
        >
          {isSwitchingTeam ? (
            <View style={styles.heroLoadingWrap}>
              <ActivityIndicator size="small" color="#111827" />
              <Text style={styles.heroLoadingText}>加载主队赛程...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.heroBo}>{featuredMatch ? inferBestOfForTeamMatch(featuredMatch) : "BO -"}</Text>
              <View style={styles.heroTeams}>
                <View style={styles.heroTeamItem}>
                  <LogoSquare uri={info.logo_url || HOME_IMAGE_URLS.defaultLogo} />
                  <Text style={styles.heroTeamName}>
                    {selectedTeamId
                      ? getTeamAbbr(info.name, (info as { tag?: string | null }).tag)
                      : "请先选择主队"}
                  </Text>
                </View>
                <View style={styles.heroTeamItem}>
                  <LogoSquare uri={teamLogoUri(opponent) || HOME_IMAGE_URLS.defaultLogo} />
                  <Text style={styles.heroTeamName}>
                    {selectedTeamId ? getTeamAbbr(opponent?.name, opponent?.tag) : "-"}
                  </Text>
                </View>
              </View>
              <Text style={styles.heroTime}>
                {selectedTeamId && featuredMatch
                  ? featuredIsLive
                    ? (() => {
                        const liveScore = scoreText(featuredMatch);
                        return liveScore === "-" ? "LIVE | 比赛进行中" : `LIVE | ${liveScore}`;
                      })()
                    : `${formatCountdown(featuredMatch.match_datetime)} | ${formatDateTime(featuredMatch.match_datetime)}`
                  : selectedTeamId
                    ? "暂无下一场比赛"
                    : "请选择主队后查看赛程"}
              </Text>
            </>
          )}
        </Pressable>

        <View style={styles.matchHeader}>
          <Text style={styles.sectionTitleEn}>Matches</Text>
          <View style={styles.toggleWrap}>
            <Pressable
              onPress={() => setTab("upcoming")}
              style={[styles.toggleBtn, tab === "upcoming" && styles.toggleBtnActive]}
            >
              <Text style={[styles.toggleText, tab === "upcoming" && styles.toggleTextActive]}>Upcoming</Text>
            </Pressable>
            <Pressable
              onPress={() => setTab("completed")}
              style={[styles.toggleBtn, tab === "completed" && styles.toggleBtnActive]}
            >
              <Text style={[styles.toggleText, tab === "completed" && styles.toggleTextActive]}>Completed</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.listWrap}>
          {activeVctHook.loading && !activeVctHook.data ? (
            <View style={styles.listLoading}>
              <ActivityIndicator size="small" color="#111827" />
              <Text style={styles.listLoadingText}>正在加载比赛...</Text>
            </View>
          ) : null}
          {list.map((match, index) => (
            <Pressable
              key={`${match.match_id || "match"}-${index}`}
              onPress={() => navigation.navigate("MatchDetail", { matchId: match.match_id })}
              style={[styles.matchRow, index % 2 === 1 && styles.matchRowAlt]}
            >
              <View style={styles.rowLeft}>
                <View style={styles.teamLine}>
                  <LogoSquare uri={teamLogoUri(match.team1) || HOME_IMAGE_URLS.defaultLogo} />
                  <Text style={styles.teamLineText}>{match.team1?.name || "-"}</Text>
                </View>
                <View style={styles.teamLine}>
                  <LogoSquare uri={teamLogoUri(match.team2) || HOME_IMAGE_URLS.defaultLogo} />
                  <Text style={styles.teamLineText}>{match.team2?.name || "-"}</Text>
                </View>
              </View>
              <Text style={styles.rowBo}>{formatSeries(match.best_of || undefined)}</Text>
              <View style={styles.rowRight}>
                {tab === "upcoming" ? (
                  <>
                    <Text style={styles.rowTime}>{formatCountdown(match.match_datetime)}</Text>
                    <Text style={styles.rowDate}>{formatDateTime(match.match_datetime)}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.rowScore}>{scoreText(match as TeamMatch)}</Text>
                    <Text style={styles.rowDate}>{formatDateTime(match.match_datetime)}</Text>
                  </>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={styles.homeBtn} onPress={() => navigation.navigate("Home")}>
          <IconImage
            uri={HOME_IMAGE_URLS.navHomeIcon}
            fallback="home"
            size={22}
          />
        </Pressable>
        <View style={styles.rightNav}>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Matches")}>
            <IconImage
              uri={HOME_IMAGE_URLS.navMatchIcon}
              fallback="calendar-outline"
              size={20}
            />
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Events")}>
            <IconImage
              uri={HOME_IMAGE_URLS.navEventIcon}
              fallback="trophy-outline"
              size={20}
            />
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Players")}>
            <IconImage
              uri={HOME_IMAGE_URLS.navPlayerIcon}
              fallback="people-outline"
              size={20}
            />
          </Pressable>
        </View>
      </View>

      <Modal visible={selectorVisible} transparent animationType="fade">
        <View style={styles.modalMask}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectorVisible(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>选择主队</Text>
            <Text style={styles.modalSubtitle}>先选赛区，再选队伍</Text>

            {selectorHook.loading ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color="#111827" />
                <Text style={styles.modalLoadingText}>加载赛区中...</Text>
              </View>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.regionRow}
                >
                  {regionOptions.map((region) => (
                    <Pressable
                      key={region.region}
                      onPress={() => setSelectedRegion(region.region)}
                      style={[
                        styles.regionItem,
                        selectedRegion === region.region && styles.regionItemActive,
                      ]}
                    >
                      <Image
                        source={{
                          uri:
                            HOME_REGION_ICON_URLS[region.region] ||
                            HOME_IMAGE_URLS.regionDefaultIcon,
                        }}
                        style={styles.regionIcon}
                        resizeMode="contain"
                      />
                      <Text style={styles.regionText}>{region.region}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <ScrollView style={styles.teamListWrap}>
                  <View style={styles.teamGrid}>
                    {selectedRegionTeams.map((team) => (
                      <Pressable
                        key={team.team_id}
                        onPress={() => onSelectTeam(team.team_id)}
                        style={styles.teamItem}
                      >
                        <LogoSquare
                          uri={team.logo_url || HOME_IMAGE_URLS.defaultLogo}
                          size={36}
                          borderRadius={8}
                        />
                        <Text style={styles.teamName}>{team.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#efefef",
  },
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 120,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIconWrap: {
    width: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    marginTop: 26,
    marginBottom: 6,
    fontSize: 34 / 2,
    fontWeight: "800",
    color: "#111827",
  },
  switchTeamBtn: {
    alignSelf: "flex-start",
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#d7d7d7",
  },
  switchTeamBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },
  sectionTitleEn: {
    fontSize: 36 / 2,
    fontWeight: "800",
    color: "#111827",
  },
  heroCard: {
    backgroundColor: "#d7d7d7",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  heroBo: {
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  heroTeams: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroTeamItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroTeamName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
    maxWidth: 120,
  },
  heroTime: {
    marginTop: 10,
    textAlign: "center",
    color: "#111827",
    letterSpacing: 0.5,
  },
  heroLoadingWrap: {
    minHeight: 94,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroLoadingText: {
    color: "#4b5563",
    fontSize: 12,
  },
  matchHeader: {
    marginTop: 28,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleWrap: {
    flexDirection: "row",
    backgroundColor: "#d7d7d7",
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  toggleBtn: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toggleBtnActive: {
    backgroundColor: "#8f8f8f",
  },
  toggleText: {
    fontSize: 11,
    color: "#111827",
    fontWeight: "600",
  },
  toggleTextActive: {
    color: "#111827",
    fontWeight: "700",
  },
  listWrap: {
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
  },
  listLoading: {
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },
  listLoadingText: {
    color: "#4b5563",
    fontSize: 12,
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
  rowTime: {
    color: "#111827",
    fontWeight: "700",
  },
  rowDate: {
    color: "#4b5563",
    fontWeight: "700",
    fontSize: 12,
  },
  rowScore: {
    color: "#111827",
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 18,
  },
  bottomBar: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  homeBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#d7d7d7",
    alignItems: "center",
    justifyContent: "center",
  },
  rightNav: {
    flex: 1,
    marginLeft: 16,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#d7d7d7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  navBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#c9c9c9",
  },
  modalMask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    backgroundColor: "#f3f4f6",
    borderRadius: 16,
    padding: 14,
    maxHeight: "78%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  modalSubtitle: {
    marginTop: 4,
    color: "#6b7280",
  },
  modalLoading: {
    paddingVertical: 18,
    alignItems: "center",
  },
  modalLoadingText: {
    marginTop: 8,
    color: "#4b5563",
  },
  regionRow: {
    paddingTop: 12,
    gap: 10,
  },
  regionItem: {
    width: 82,
    borderRadius: 12,
    backgroundColor: "#e5e7eb",
    paddingVertical: 10,
    alignItems: "center",
  },
  regionItemActive: {
    backgroundColor: "#d1d5db",
  },
  regionIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  regionText: {
    marginTop: 7,
    fontSize: 12,
    color: "#111827",
    fontWeight: "600",
  },
  teamListWrap: {
    marginTop: 12,
    maxHeight: 320,
  },
  teamGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  teamItem: {
    width: "31%",
    borderRadius: 10,
    backgroundColor: "#e5e7eb",
    paddingVertical: 10,
    alignItems: "center",
  },
  teamName: {
    marginTop: 6,
    fontSize: 12,
    textAlign: "center",
    color: "#111827",
    fontWeight: "600",
  },
});

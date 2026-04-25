import { Ionicons } from "@expo/vector-icons";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { CompositeNavigationProp, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HomeVctMatchItem, MatchDetailResponse, MatchListItem, MatchTeam } from "../api/types";
import { getHistoryMatches, getHomeVctMatches, getLiveMatches, getMatchDetail } from "../api/vlrApi";
import { HOME_IMAGE_URLS, HOME_REGION_ICON_URLS } from "../config/homeConfig";
import { usePersistedAsyncData } from "../hooks/usePersistedAsyncData";
import { PERSIST_KEYS } from "../bootstrap/preload";
import { MainTabParamList, RootStackParamList } from "../navigation/types";

type MatchTab = "upcoming" | "completed";
type HomeNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

type RegionValue = "americas" | "emea" | "pacific" | "china" | "masters" | "champions";

const REGION_ORDER = ["Americas", "EMEA", "Pacific", "China", "Masters", "Champs"] as const;

const REGION_OPTIONS: Array<{ value: RegionValue; label: string; icon: string }> = REGION_ORDER.reduce(
  (acc, r) => {
    const value = normalizeRegionValue(r);
    if (value) {
      acc.push({ value, label: r, icon: regionIconFor(r) });
    }
    return acc;
  },
  [] as Array<{ value: RegionValue; label: string; icon: string }>
);
const DEFAULT_SELECTED_REGIONS: RegionValue[] = REGION_OPTIONS.map((r) => r.value);
const ALL_REGIONS_COUNT = DEFAULT_SELECTED_REGIONS.length;
const MATCHES_PAGE_SIZE = 20;
const MATCHES_FETCH_LIMIT = 120;
const MATCH_WINDOW_HOURS = 10;

export function MatchesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<HomeNav>();
  const [tab, setTab] = useState<MatchTab>("upcoming");
  const [selectedRegions, setSelectedRegions] = useState<RegionValue[]>([...DEFAULT_SELECTED_REGIONS]);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [filterVisible, setFilterVisible] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const filterBtnRef = useRef<View>(null);
  const [refreshing, setRefreshing] = useState(false);

  const screenWidth = Dimensions.get("window").width;
  const dropdownWidth = Math.round(screenWidth * 0.5);
  const dropdownLeft = Math.max(
    8,
    Math.min(filterAnchor.x + filterAnchor.width - dropdownWidth, screenWidth - dropdownWidth - 8)
  );
  const dropdownTop = Math.max(insets.top + 8, filterAnchor.y);

  const ongoingHook = usePersistedAsyncData(PERSIST_KEYS.matchesLive, () => getLiveMatches(50), []);
  const upcomingHook = usePersistedAsyncData(
    PERSIST_KEYS.matchesVctUpcoming,
    () => getHomeVctMatches("upcoming", MATCHES_FETCH_LIMIT, 2),
    []
  );
  const completedHook = usePersistedAsyncData(
    PERSIST_KEYS.matchesVctCompleted,
    () => getHomeVctMatches("completed", MATCHES_FETCH_LIMIT, 2),
    []
  );

  const activeVctHook = tab === "upcoming" ? upcomingHook : completedHook;

  const vctMatchById = useMemo(() => {
    const map = new Map<number, HomeVctMatchItem>();
    for (const row of (upcomingHook.data?.items || []) as HomeVctMatchItem[]) {
      if (row.match_id) map.set(row.match_id, row);
    }
    for (const row of (completedHook.data?.items || []) as HomeVctMatchItem[]) {
      if (row.match_id) map.set(row.match_id, row);
    }
    return map;
  }, [upcomingHook.data, completedHook.data]);

  const vctTeamLogoById = useMemo(() => {
    const upcoming = (upcomingHook.data?.items || []) as HomeVctMatchItem[];
    const completed = (completedHook.data?.items || []) as HomeVctMatchItem[];
    return buildTeamLogoIndex([...upcoming, ...completed]);
  }, [upcomingHook.data, completedHook.data]);

  const ongoingDisplayPairs = useMemo(() => {
    const liveRows = (ongoingHook.data?.items || []) as MatchListItem[];
    return liveRows.map((live) => ({
      live,
      row: mergeOngoingIntoVctShape(live, vctMatchById.get(live.match_id), vctTeamLogoById),
    }));
  }, [ongoingHook.data, vctMatchById, vctTeamLogoById]);

  const filteredOngoing = useMemo(() => {
    return ongoingDisplayPairs.filter(({ row, live }) =>
      matchesRegion(row.event_name || live.event, selectedRegions)
    );
  }, [ongoingDisplayPairs, selectedRegions]);

  const filteredUpcoming = useMemo(() => {
    const rows = (upcomingHook.data?.items || []) as HomeVctMatchItem[];
    const filtered = rows.filter((row) => matchesRegion(row.event_name, selectedRegions));
    // Upcoming：时间越近越靠前
    return [...filtered].sort((a, b) => {
      const ta = a.match_datetime ? new Date(a.match_datetime).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.match_datetime ? new Date(b.match_datetime).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }, [upcomingHook.data, selectedRegions]);
  const filteredCompleted = useMemo(() => {
    const rows = (completedHook.data?.items || []) as HomeVctMatchItem[];
    const filtered = rows.filter((row) => matchesRegion(row.event_name, selectedRegions));
    // Completed：最新结束的比赛排在最前面，避免“明明有但翻页才看到”
    return [...filtered].sort((a, b) => {
      const ta = a.match_datetime ? new Date(a.match_datetime).getTime() : 0;
      const tb = b.match_datetime ? new Date(b.match_datetime).getTime() : 0;
      return tb - ta;
    });
  }, [completedHook.data, selectedRegions]);

  const activeRows = tab === "upcoming" ? filteredUpcoming : filteredCompleted;
  const activePage = tab === "upcoming" ? upcomingPage : completedPage;
  const totalPages = Math.max(1, Math.ceil(activeRows.length / MATCHES_PAGE_SIZE));
  const hasPrevPage = activePage > 1;
  const hasNextPage = activePage < totalPages;
  const startIndex = (activePage - 1) * MATCHES_PAGE_SIZE;
  const pagedRows = activeRows.slice(startIndex, startIndex + MATCHES_PAGE_SIZE);

  useEffect(() => {
    if (tab === "upcoming" && upcomingPage > totalPages) {
      setUpcomingPage(totalPages);
    }
    if (tab === "completed" && completedPage > totalPages) {
      setCompletedPage(totalPages);
    }
  }, [tab, totalPages, upcomingPage, completedPage]);

  useEffect(() => {
    setUpcomingPage(1);
    setCompletedPage(1);
  }, [selectedRegions.join("|")]);

  function openFilter() {
    filterBtnRef.current?.measureInWindow((x, y, width, height) => {
      setFilterAnchor({ x, y, width, height });
      setFilterVisible(true);
    });
  }

  function mergeByIdKeepingOutsideWindow(existing: HomeVctMatchItem[], fresh: HomeVctMatchItem[]) {
    const byId = new Map<number, HomeVctMatchItem>();
    for (const row of fresh) {
      if (row.match_id) byId.set(row.match_id, row);
    }

    const existingIds = new Set<number>();
    for (const row of existing) {
      if (row.match_id) existingIds.add(row.match_id);
    }

    // 关键修复：窗口内 fresh 里新增的 match 也要插入，否则刚结束的比赛会短暂“两边都不出现”
    const newInWindow = fresh.filter((row) => {
      if (!row.match_id) return false;
      if (existingIds.has(row.match_id)) return false;
      return withinWindowIso(row.match_datetime, MATCH_WINDOW_HOURS);
    });

    const replacedExisting = existing.map((row) => {
      if (!row.match_id) return row;
      if (!withinWindowIso(row.match_datetime, MATCH_WINDOW_HOURS)) return row;
      return byId.get(row.match_id) || row;
    });

    return [...newInWindow, ...replacedExisting];
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      setUpcomingPage(1);
      setCompletedPage(1);

      // 进行中比赛：全量刷新（数量本就少）
      await ongoingHook.reload();

      // Upcoming/Completed：仅刷新当前时间±10小时内的比赛
      const [freshUpcoming, freshCompleted] = await Promise.all([
        getHomeVctMatches("upcoming", 60, 1),
        getHomeVctMatches("completed", 60, 1),
      ]);

      const existingUpcoming = ((upcomingHook.data?.items || []) as HomeVctMatchItem[]) || [];
      const existingCompleted = ((completedHook.data?.items || []) as HomeVctMatchItem[]) || [];
      const mergedUpcoming = mergeByIdKeepingOutsideWindow(
        existingUpcoming,
        (freshUpcoming.items || []) as HomeVctMatchItem[]
      );
      let mergedCompleted = mergeByIdKeepingOutsideWindow(
        existingCompleted,
        (freshCompleted.items || []) as HomeVctMatchItem[]
      );

      // 关键兜底：如果 /match/vct 的 completed 缺失某些「刚结束」比赛，
      // 仅在 VCT 且时间窗口内时，用 /match/history 找 match_id，再用 /match/:id 详情补齐 BO 与队标。
      const vctCompletedIds = new Set<number>(mergedCompleted.map((m) => m.match_id).filter(Boolean) as number[]);
      const history = await getHistoryMatches(160);
      const rawRows = (history.items || []) as MatchListItem[];
      const vctCandidates = rawRows
        .map((r) => ({ row: r, iso: parseDateTimeFromParts(r.date, r.time) }))
        .filter(
          ({ row, iso }) =>
            isLikelyVctEvent(row.event) && withinWindowIso(iso || undefined, MATCH_WINDOW_HOURS)
        );

      const missing = vctCandidates
        .map(({ row, iso }) => ({ matchId: row.match_id, iso: iso || undefined }))
        .filter(
          (x) => Number.isFinite(x.matchId) && x.matchId > 0 && !vctCompletedIds.has(x.matchId)
        );

      if (missing.length) {
        const enriched = await fetchMissingCompletedAsVctItems(missing.slice(0, 6));
        if (enriched.length) {
          mergedCompleted = [...enriched, ...mergedCompleted];
        }
      }

      // 写回页面状态 + 本地落盘（避免触发全量 reload）
      await Promise.all([
        upcomingHook.update({ ...freshUpcoming, items: mergedUpcoming }, true),
        completedHook.update({ ...freshCompleted, items: mergedCompleted }, true),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={styles.safe}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18 }]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerIconWrap}>
            <LogoSquare uri={HOME_IMAGE_URLS.topAvatar} size={38} borderRadius={10} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Ongoing Matches</Text>
        <View style={styles.listWrap}>
          {ongoingHook.loading && !ongoingHook.data ? (
            <LoadingInCard text="正在加载进行中比赛..." />
          ) : ongoingHook.error ? (
            <CardText text="进行中比赛加载失败" />
          ) : selectedRegions.length === 0 ? (
            <CardText text="请先选择赛区" />
          ) : filteredOngoing.length === 0 ? (
            <CardText text="暂无正在进行的比赛" />
          ) : (
            filteredOngoing.map(({ row, live }, index) => {
              const sc = scoreText(row.team1, row.team2);
              const boText = row.best_of ? formatSeries(row.best_of) : bestOfForLive(live);
              return (
                <MatchRow
                  key={`${row.match_id || "live"}-${index}`}
                  alt={index % 2 === 1}
                  team1={row.team1}
                  team2={row.team2}
                  boText={boText}
                  rightTop={sc === "-" ? "LIVE" : sc}
                  rightBottom={formatDateTime(row.match_datetime)}
                  topVariant={sc === "-" ? "default" : "score"}
                  onPress={() => {
                    if (row.match_id) navigation.navigate("MatchDetail", { matchId: row.match_id });
                  }}
                />
              );
            })
          )}
        </View>

        <View style={styles.matchHeader}>
          <Text style={styles.sectionTitleEn}>Matches</Text>
          <View style={styles.headerActions}>
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
            <Pressable ref={filterBtnRef} style={styles.filterBtn} onPress={openFilter}>
              <Ionicons name="options-outline" size={18} color="#111827" />
            </Pressable>
          </View>
        </View>

        <View style={styles.listWrap}>
          {activeVctHook.loading && !activeVctHook.data ? (
            <LoadingInCard text="正在加载比赛..." />
          ) : activeVctHook.error ? (
            <CardText text="比赛列表加载失败" />
          ) : selectedRegions.length === 0 ? (
            <CardText text="请先选择赛区" />
          ) : activeRows.length === 0 ? (
            <CardText text="该赛区暂无比赛" />
          ) : (
            pagedRows.map((match, index) => (
              <MatchRow
                key={`${match.match_id || "vct"}-${startIndex + index}`}
                alt={index % 2 === 1}
                team1={match.team1}
                team2={match.team2}
                boText={formatSeries(match.best_of || undefined)}
                rightTop={
                  tab === "upcoming" ? formatCountdown(match.match_datetime) : scoreText(match.team1, match.team2)
                }
                rightBottom={formatDateTime(match.match_datetime)}
                topVariant={tab === "completed" ? "score" : "default"}
                onPress={() => navigation.navigate("MatchDetail", { matchId: match.match_id })}
              />
            ))
          )}
        </View>
        <View style={styles.paginationWrap}>
          <Pressable
            style={[styles.pageBtn, !hasPrevPage && styles.pageBtnDisabled]}
            onPress={() => {
              if (!hasPrevPage) return;
              if (tab === "upcoming") setUpcomingPage((p) => Math.max(1, p - 1));
              else setCompletedPage((p) => Math.max(1, p - 1));
            }}
            disabled={!hasPrevPage}
          >
            <Text style={styles.pageBtnText}>上一页</Text>
          </Pressable>
          <Text style={styles.pageText}>第 {activePage} 页</Text>
          <Pressable
            style={[styles.pageBtn, (!hasNextPage || activeVctHook.loading) && styles.pageBtnDisabled]}
            onPress={() => {
              if (!hasNextPage || activeVctHook.loading) return;
              if (tab === "upcoming") setUpcomingPage((p) => p + 1);
              else setCompletedPage((p) => p + 1);
            }}
            disabled={!hasNextPage || activeVctHook.loading}
          >
            <Text style={styles.pageBtnText}>下一页</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable style={styles.homeBtn} onPress={() => navigation.navigate("Home")}>
          <IconImage uri={HOME_IMAGE_URLS.navHomeIcon} fallback="home" size={22} />
        </Pressable>
        <View style={styles.rightNav}>
          <Pressable style={[styles.navBtn, styles.navBtnActive]} onPress={() => navigation.navigate("Matches")}>
            <IconImage uri={HOME_IMAGE_URLS.navMatchIcon} fallback="calendar-outline" size={20} />
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Events")}>
            <IconImage uri={HOME_IMAGE_URLS.navEventIcon} fallback="trophy-outline" size={20} />
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Players")}>
            <IconImage uri={HOME_IMAGE_URLS.navPlayerIcon} fallback="people-outline" size={20} />
          </Pressable>
        </View>
      </View>

      <Modal visible={filterVisible} transparent animationType="fade">
        <View style={styles.filterMask}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFilterVisible(false)} />
          <View style={[styles.filterDropdown, { width: dropdownWidth, left: dropdownLeft, top: dropdownTop }]}>
            <Text style={styles.filterTitle}>Region</Text>
            <View style={styles.regionGrid}>
              {REGION_OPTIONS.map((region) => (
                <Pressable
                  key={region.value}
                  onPress={() => {
                    setSelectedRegions((prev) =>
                      prev.includes(region.value)
                        ? prev.filter((v) => v !== region.value)
                        : [...prev, region.value]
                    );
                  }}
                  style={[styles.regionItem, selectedRegions.includes(region.value) && styles.regionItemActive]}
                >
                  <Image source={{ uri: region.icon }} style={styles.regionIcon} resizeMode="contain" />
                  <Text style={styles.regionText}>{region.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.clearAllBtn, selectedRegions.length === 0 && styles.clearAllBtnDisabled]}
              onPress={() => setSelectedRegions([])}
              disabled={selectedRegions.length === 0}
            >
              <Text style={styles.clearAllText}>取消全选</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
        <Text style={styles.rowDate}>{rightBottom}</Text>
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

function formatSeries(series?: string) {
  if (!series) return "BO ?";
  const text = series.toUpperCase().replace(/\s+/g, " ").trim();
  const match = text.match(/BO\s*([1-9])/);
  if (match?.[1]) return `BO ${match[1]}`;
  return text;
}

function bestOfForLive(match: MatchListItem) {
  const raw = match as MatchListItem & {
    best_of?: string;
    phase?: string;
    series?: string;
    event_name?: string;
  };
  const direct = formatSeries(raw.best_of || raw.series || undefined);
  if (direct !== "BO ?" && direct !== (raw.best_of || raw.series || "").toUpperCase()) {
    return direct;
  }
  const source = `${match.event_phase || ""} ${raw.phase || ""} ${raw.event || ""} ${raw.event_name || ""}`.toLowerCase();
  const bo = source.match(/\bbo\s*([1-9])\b/i)?.[1];
  if (bo) return `BO ${bo}`;
  if (/(grand final|lower final|upper final|final)/.test(source)) return "BO 5";
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
  return `${month} ${day} ${hh}:${mm}`;
}

function parseDateTimeFromParts(date?: string, time?: string) {
  const d = (date || "").trim();
  if (!d) return null;
  // 期望 d 为 YYYY-MM-DD
  const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const t = (time || "").trim();
  let hh = 0;
  let mm = 0;
  if (t) {
    // 支持：`4:00 PM` / `04:00 PM` / `16:00` / `4:00`
    const m12 = t.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m12) {
      hh = Number(m12[1]);
      mm = Number(m12[2]);
      const ap = m12[3].toUpperCase();
      if (ap === "PM" && hh < 12) hh += 12;
      if (ap === "AM" && hh === 12) hh = 0;
    } else if (m24) {
      hh = Number(m24[1]);
      mm = Number(m24[2]);
    } else {
      // 最后兜底：仅取前 5 位尝试 24h
      const head = t.slice(0, 5);
      const m = head.match(/^(\d{1,2}):(\d{2})$/);
      if (m) {
        hh = Number(m[1]);
        mm = Number(m[2]);
      } else {
        return null;
      }
    }
  }

  if (![year, month, day, hh, mm].every((n) => Number.isFinite(n))) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;

  // 用本地时区构造，保证跨平台解析一致
  const dt = new Date(year, month - 1, day, hh, mm, 0, 0);
  const ts = dt.getTime();
  if (!Number.isFinite(ts)) return null;
  return dt.toISOString();
}

function withinWindowIso(iso?: string, hours = 10) {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return false;
  const diff = Math.abs(ts - Date.now());
  return diff <= hours * 60 * 60 * 1000;
}

function isLikelyVctEvent(eventName?: string) {
  const text = (eventName || "").toLowerCase();
  // 避免把 Challengers / Academy / GC / 乱七八糟的联赛塞进主列表
  if (!text.includes("vct")) return false;
  if (text.includes("challengers")) return false;
  if (text.includes("academy")) return false;
  if (text.includes("game changers") || /\bgc\b/.test(text)) return false;
  return true;
}

const MATCH_DETAIL_CACHE = new Map<number, MatchDetailResponse>();
const MATCH_DETAIL_INFLIGHT = new Map<number, Promise<MatchDetailResponse | null>>();

async function loadMatchDetailCached(matchId: number) {
  const hit = MATCH_DETAIL_CACHE.get(matchId);
  if (hit) return hit;
  const inflight = MATCH_DETAIL_INFLIGHT.get(matchId);
  if (inflight) return inflight;
  const p = getMatchDetail(matchId)
    .then((d) => {
      if (d) MATCH_DETAIL_CACHE.set(matchId, d as MatchDetailResponse);
      MATCH_DETAIL_INFLIGHT.delete(matchId);
      return (d as MatchDetailResponse) || null;
    })
    .catch(() => {
      MATCH_DETAIL_INFLIGHT.delete(matchId);
      return null;
    });
  MATCH_DETAIL_INFLIGHT.set(matchId, p);
  return p;
}

function toHomeVctFromDetail(detail: MatchDetailResponse, fallbackIso?: string): HomeVctMatchItem | null {
  const match_id = detail?.info?.match_id;
  if (!Number.isFinite(match_id) || match_id <= 0) return null;
  const match_datetime = parseDateTimeFromParts(detail.info?.date, detail.info?.time) || fallbackIso || undefined;
  return {
    match_id,
    status: "completed",
    event_name: detail.info?.event,
    phase: detail.info?.event_phase,
    match_datetime,
    best_of: detail.info?.best_of ?? null,
    team1: {
      id: detail.teams?.[0]?.id,
      name: detail.teams?.[0]?.name,
      tag: detail.teams?.[0]?.tag ?? null,
      score: detail.teams?.[0]?.score ?? null,
      logo: detail.teams?.[0]?.logo_url ?? null,
    },
    team2: {
      id: detail.teams?.[1]?.id,
      name: detail.teams?.[1]?.name,
      tag: detail.teams?.[1]?.tag ?? null,
      score: detail.teams?.[1]?.score ?? null,
      logo: detail.teams?.[1]?.logo_url ?? null,
    },
  };
}

async function fetchMissingCompletedAsVctItems(missing: Array<{ matchId: number; iso?: string }>) {
  const dedup = new Map<number, string | undefined>();
  for (const m of missing) {
    if (!Number.isFinite(m.matchId) || m.matchId <= 0) continue;
    if (!dedup.has(m.matchId)) dedup.set(m.matchId, m.iso);
  }
  const ids = Array.from(dedup.keys());
  if (!ids.length) return [] as HomeVctMatchItem[];
  const details = await Promise.all(ids.map((id) => loadMatchDetailCached(id)));
  const out: HomeVctMatchItem[] = [];
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    if (!d) continue;
    if (!isLikelyVctEvent(d.info?.event)) continue;
    const fallbackIso = dedup.get(ids[i]!) || undefined;
    const item = toHomeVctFromDetail(d, fallbackIso);
    if (!item) continue;
    // 只补窗口内，避免污染
    if (!withinWindowIso(item.match_datetime, MATCH_WINDOW_HOURS)) continue;
    out.push(item);
  }
  return out;
}

function pickLiveTeam(match: MatchListItem, index: 0 | 1): MatchTeam {
  const fallback = index === 0 ? match.team1 : match.team2;
  const anyMatch = match as MatchListItem & {
    teams?: Array<MatchTeam & { logo_url?: string | null; image_url?: string | null }>;
  };
  const fromArray = anyMatch.teams?.[index];
  const src = fromArray || fallback || {};
  const anyTeam = src as MatchTeam & { logo_url?: string | null; image_url?: string | null };
  const logo = anyTeam.logo || anyTeam.logo_url || anyTeam.image_url || null;
  return {
    id: src.id,
    name: src.name,
    tag: src.tag ?? null,
    score: src.score ?? null,
    country: src.country,
    logo,
  };
}

function formatLiveDateTime(match: MatchListItem) {
  const anyMatch = match as MatchListItem & { match_datetime?: string };
  const iso = anyMatch.match_datetime || parseDateTimeFromParts(match.date, match.time);
  if (iso) return formatDateTime(iso);
  return "-";
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

function scoreText(team1?: MatchTeam, team2?: MatchTeam) {
  const a = team1?.score;
  const b = team2?.score;
  if (a === undefined || a === null || b === undefined || b === null) return "-";
  return `${a} : ${b}`;
}

function teamLogo(team?: MatchTeam) {
  if (!team) return null;
  const anyTeam = team as MatchTeam & { logo_url?: string | null; image_url?: string | null };
  const raw = anyTeam.logo || anyTeam.logo_url || anyTeam.image_url;
  if (!raw) return null;
  const url = String(raw).trim();
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

/** 与 /match/vct 列表一致：从已加载的 VCT 赛程里收集队标，供 live 行按 team_id 回填。 */
function buildTeamLogoIndex(rows: HomeVctMatchItem[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    for (const side of [row.team1, row.team2]) {
      if (!side?.id) continue;
      const u = teamLogo(side);
      if (u) map.set(side.id, u);
    }
  }
  return map;
}

function mergeOngoingSide(
  vctSide: MatchTeam | undefined,
  liveSide: MatchTeam,
  logoByTeamId: Map<number, string>
): MatchTeam {
  const id = vctSide?.id ?? liveSide.id;
  const fromIndex = typeof id === "number" ? logoByTeamId.get(id) : undefined;
  const resolvedLogo =
    teamLogo(vctSide) || teamLogo(liveSide) || fromIndex || null;
  return {
    ...liveSide,
    ...vctSide,
    id,
    name: vctSide?.name || liveSide.name,
    tag: vctSide?.tag ?? liveSide.tag ?? null,
    score: liveSide.score ?? vctSide?.score ?? null,
    logo: resolvedLogo ?? (vctSide as MatchTeam | undefined)?.logo ?? liveSide.logo ?? null,
  };
}

/** 按 team_id 对齐 VCT 的 team1/team2 到 live 的左右边，避免两接口队伍顺序相反时队名/队标错位。 */
function alignVctSidesToLive(
  live: MatchListItem,
  vct: HomeVctMatchItem | undefined
): { vctForLive1?: MatchTeam; vctForLive2?: MatchTeam } {
  if (!vct) return {};
  const l1 = pickLiveTeam(live, 0);
  const l2 = pickLiveTeam(live, 1);
  const a = vct.team1;
  const b = vct.team2;
  const l1id = l1?.id;
  const l2id = l2?.id;
  if (l1id != null && a?.id === l1id) return { vctForLive1: a, vctForLive2: b };
  if (l1id != null && b?.id === l1id) return { vctForLive1: b, vctForLive2: a };
  return { vctForLive1: a, vctForLive2: b };
}

/** 将 live 与 vct 同源行合并为与下方 Upcoming/Completed 相同的 HomeVctMatchItem 形态，便于复用 MatchRow。 */
function mergeOngoingIntoVctShape(
  live: MatchListItem,
  vct: HomeVctMatchItem | undefined,
  logoByTeamId: Map<number, string>
): HomeVctMatchItem {
  const lt1 = pickLiveTeam(live, 0);
  const lt2 = pickLiveTeam(live, 1);
  const { vctForLive1, vctForLive2 } = alignVctSidesToLive(live, vct);
  const team1 = mergeOngoingSide(vctForLive1, lt1, logoByTeamId);
  const team2 = mergeOngoingSide(vctForLive2, lt2, logoByTeamId);
  const matchDatetime =
    vct?.match_datetime || parseDateTimeFromParts(live.date, live.time) || undefined;
  return {
    match_id: live.match_id,
    status: "upcoming",
    event_name: vct?.event_name ?? live.event,
    phase: vct?.phase ?? live.event_phase,
    match_datetime: matchDatetime,
    best_of: vct?.best_of ?? null,
    team1,
    team2,
  };
}

function normalizeRegionValue(value: string): RegionValue | null {
  const v = (value || "").trim().toLowerCase();
  if (v === "americas") return "americas";
  if (v === "emea") return "emea";
  if (v === "pacific") return "pacific";
  if (v === "china") return "china";
  if (v === "masters") return "masters";
  if (v === "champs" || v === "champions") return "champions";
  return null;
}

function regionIconFor(regionName: string) {
  const v = normalizeRegionValue(regionName);
  if (!v) {
    return HOME_IMAGE_URLS.regionDefaultIcon;
  }
  if (v === "emea") {
    return HOME_REGION_ICON_URLS.EMEA || HOME_REGION_ICON_URLS.emea || HOME_IMAGE_URLS.regionDefaultIcon;
  }
  if (v === "champions") {
    return (
      HOME_REGION_ICON_URLS.Champs ||
      HOME_REGION_ICON_URLS.Champions ||
      HOME_REGION_ICON_URLS.champs ||
      HOME_REGION_ICON_URLS.champions ||
      HOME_IMAGE_URLS.regionDefaultIcon
    );
  }
  const key = v.charAt(0).toUpperCase() + v.slice(1);
  return HOME_REGION_ICON_URLS[key] || HOME_REGION_ICON_URLS[v] || HOME_IMAGE_URLS.regionDefaultIcon;
}

function detectRegion(eventName?: string): RegionValue | "" {
  const text = (eventName || "").toLowerCase();
  if (text.includes("champions") || text.includes("champs")) return "champions";
  if (text.includes("masters")) return "masters";
  if (text.includes("emea") || text.includes("europe") || text.includes("middle east")) return "emea";
  if (text.includes("pacific") || text.includes("apac")) return "pacific";
  if (text.includes("china") || /\bvct\s*cn\b/.test(text) || /\bcn\b/.test(text)) return "china";
  if (text.includes("americas") || text.includes("latam") || text.includes("latin america")) return "americas";
  if (text.includes("americas")) return "americas";
  if (text.includes("emea")) return "emea";
  if (text.includes("pacific")) return "pacific";
  if (text.includes("china")) return "china";
  return "";
}

function matchesRegion(eventName: string | undefined, selectedRegions: RegionValue[]) {
  if (selectedRegions.length === 0) return false;
  const eventRegion = detectRegion(eventName);
  if (!eventRegion) {
    return selectedRegions.length >= ALL_REGIONS_COUNT;
  }
  return selectedRegions.includes(eventRegion);
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
    marginBottom: 10,
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  sectionTitleEn: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  matchHeader: {
    marginTop: 28,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  filterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d7d7d7",
  },
  listWrap: {
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
  },
  paginationWrap: {
    marginTop: 10,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageBtn: {
    minWidth: 72,
    borderRadius: 999,
    backgroundColor: "#d7d7d7",
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  pageBtnDisabled: {
    opacity: 0.45,
  },
  pageBtnText: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
  },
  pageText: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
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
  navBtnActive: {
    backgroundColor: "#b5b5b5",
  },
  filterMask: {
    flex: 1,
  },
  filterDropdown: {
    position: "absolute",
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  filterTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginLeft: 2,
  },
  regionAllItem: {
    width: "100%",
    minHeight: 84,
    borderRadius: 14,
    backgroundColor: "#d7d7d7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  regionAllIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "transparent",
    marginTop: 2,
  },
  regionAllText: {
    marginTop: 6,
    fontSize: 17,
    color: "#111827",
    fontWeight: "800",
  },
  regionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  regionItem: {
    width: "48.5%",
    minHeight: 88,
    borderRadius: 14,
    backgroundColor: "#d7d7d7",
    paddingHorizontal: 6,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  regionItemActive: {
    backgroundColor: "#cfcfcf",
    borderColor: "#111827",
  },
  regionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "transparent",
    marginTop: 2,
  },
  regionText: {
    marginTop: 6,
    fontSize: 13,
    color: "#111827",
    fontWeight: "800",
    textAlign: "center",
  },
  clearAllBtn: {
    marginTop: 2,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d7d7d7",
    borderWidth: 1,
    borderColor: "#9ca3af",
  },
  clearAllBtnDisabled: {
    opacity: 0.45,
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#111827",
  },
});

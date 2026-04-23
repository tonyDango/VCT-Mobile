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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HomeVctMatchItem, MatchListItem, MatchTeam } from "../api/types";
import { getHomeVctMatches, getLiveMatches } from "../api/vlrApi";
import { HOME_IMAGE_URLS, HOME_REGION_ICON_URLS } from "../config/homeConfig";
import { useAsyncData } from "../hooks/useAsyncData";
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
const MATCHES_PAGE_SIZE = 20;
const MATCHES_FETCH_LIMIT = 120;

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

  const screenWidth = Dimensions.get("window").width;
  const dropdownWidth = Math.round(screenWidth * 0.5);
  const dropdownLeft = Math.max(
    8,
    Math.min(filterAnchor.x + filterAnchor.width - dropdownWidth, screenWidth - dropdownWidth - 8)
  );
  const dropdownTop = Math.max(insets.top + 8, filterAnchor.y);

  const ongoingHook = useAsyncData(() => getLiveMatches(12), []);
  const upcomingHook = useAsyncData(() => getHomeVctMatches("upcoming", MATCHES_FETCH_LIMIT, 2), []);
  const completedHook = useAsyncData(() => getHomeVctMatches("completed", MATCHES_FETCH_LIMIT, 2), []);

  const activeVctHook = tab === "upcoming" ? upcomingHook : completedHook;
  const filteredOngoing = useMemo(() => {
    const rows = (ongoingHook.data?.items || []) as MatchListItem[];
    return rows.filter((row) => matchesRegion(row.event, selectedRegions));
  }, [ongoingHook.data, selectedRegions]);

  const filteredUpcoming = useMemo(() => {
    const rows = (upcomingHook.data?.items || []) as HomeVctMatchItem[];
    return rows.filter((row) => matchesRegion(row.event_name, selectedRegions));
  }, [upcomingHook.data, selectedRegions]);
  const filteredCompleted = useMemo(() => {
    const rows = (completedHook.data?.items || []) as HomeVctMatchItem[];
    return rows.filter((row) => matchesRegion(row.event_name, selectedRegions));
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

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 18 }]}>
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
            filteredOngoing.map((match, index) => (
              <MatchRow
                key={`${match.match_id || "live"}-${index}`}
                alt={index % 2 === 1}
                team1={match.team1}
                team2={match.team2}
                boText={extractBo(match.event_phase)}
                rightTop={scoreText(match.team1, match.team2) === "-" ? "LIVE" : scoreText(match.team1, match.team2)}
                rightBottom={formatDateTimeFromParts(match.date, match.time)}
                onPress={() => {
                  if (match.match_id) navigation.navigate("MatchDetail", { matchId: match.match_id });
                }}
              />
            ))
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

function extractBo(text?: string) {
  const m = (text || "").toUpperCase().match(/BO\s*([1-9])/);
  return m?.[1] ? `BO ${m[1]}` : "BO ?";
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

function formatDateTimeFromParts(date?: string, time?: string) {
  const dateText = (date || "-").trim();
  const timeText = time ? String(time).slice(0, 5) : "--:--";
  return `${dateText} ${timeText}`;
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
  if (text.includes("americas")) return "americas";
  if (text.includes("emea")) return "emea";
  if (text.includes("pacific")) return "pacific";
  if (text.includes("china")) return "china";
  if (text.includes("masters")) return "masters";
  if (text.includes("champions") || text.includes("champs")) return "champions";
  return "";
}

function matchesRegion(eventName: string | undefined, selectedRegions: RegionValue[]) {
  if (selectedRegions.length === 0) return false;
  const eventRegion = detectRegion(eventName);
  return eventRegion ? selectedRegions.includes(eventRegion) : false;
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

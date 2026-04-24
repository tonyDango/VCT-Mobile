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

import { EventListItem } from "../api/types";
import { getEvents } from "../api/vlrApi";
import { HOME_IMAGE_URLS, HOME_REGION_ICON_URLS } from "../config/homeConfig";
import { useAsyncData } from "../hooks/useAsyncData";
import { MainTabParamList, RootStackParamList } from "../navigation/types";

type EventTab = "upcoming" | "completed";
type RegionValue = "americas" | "emea" | "pacific" | "china" | "masters" | "champions";
type HomeNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

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
const EVENTS_PAGE_SIZE = 20;
const EVENTS_FETCH_LIMIT = 120;

export function EventsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<HomeNav>();
  const [tab, setTab] = useState<EventTab>("upcoming");
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [selectedRegions, setSelectedRegions] = useState<RegionValue[]>([...DEFAULT_SELECTED_REGIONS]);
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

  const ongoingHook = useAsyncData(() => getEvents("ongoing", 60), []);
  const upcomingHook = useAsyncData(() => getEvents("upcoming", EVENTS_FETCH_LIMIT), []);
  const completedHook = useAsyncData(() => getEvents("completed", EVENTS_FETCH_LIMIT), []);

  const activeHook = tab === "upcoming" ? upcomingHook : completedHook;
  const filteredOngoing = useMemo(() => {
    const rows = (ongoingHook.data?.items || []) as EventListItem[];
    return rows.filter((row) => matchesRegion(row, selectedRegions));
  }, [ongoingHook.data, selectedRegions]);
  const filteredList = useMemo(() => {
    const rows = (activeHook.data?.items || []) as EventListItem[];
    const filtered = rows.filter((row) => matchesRegion(row, selectedRegions));
    const sorted = [...filtered];
    if (tab === "completed") {
      sorted.sort((a, b) => eventSortValue(b, tab) - eventSortValue(a, tab));
    } else {
      sorted.sort((a, b) => eventSortValue(a, tab) - eventSortValue(b, tab));
    }
    return sorted;
  }, [activeHook.data, selectedRegions, tab]);

  const activePage = tab === "upcoming" ? upcomingPage : completedPage;
  const totalPages = Math.max(1, Math.ceil(filteredList.length / EVENTS_PAGE_SIZE));
  const hasPrevPage = activePage > 1;
  const hasNextPage = activePage < totalPages;
  const startIndex = (activePage - 1) * EVENTS_PAGE_SIZE;
  const pagedRows = filteredList.slice(startIndex, startIndex + EVENTS_PAGE_SIZE);

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

  async function onRefresh() {
    setRefreshing(true);
    try {
      setUpcomingPage(1);
      setCompletedPage(1);
      await Promise.all([ongoingHook.reload(), upcomingHook.reload(), completedHook.reload()]);
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
            <LogoSquare uri={HOME_IMAGE_URLS.topAvatar} size={46} borderRadius={10} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Ongoing Events</Text>
        <View style={styles.listWrap}>
          {ongoingHook.loading && !ongoingHook.data ? (
            <LoadingInCard text="正在加载进行中赛事..." />
          ) : ongoingHook.error ? (
            <CardText text="进行中赛事加载失败" />
          ) : selectedRegions.length === 0 ? (
            <CardText text="请先选择赛区" />
          ) : filteredOngoing.length === 0 ? (
            <CardText text="暂无正在进行的赛事" />
          ) : (
            filteredOngoing.slice(0, 8).map((event, index) => (
              <EventRow
                key={`${event.id || "ongoing"}-${index}`}
                item={event}
                alt={index % 2 === 1}
                onPress={() => navigation.navigate("EventDetail", { eventId: event.id })}
              />
            ))
          )}
        </View>

        <View style={styles.matchHeader}>
          <Text style={styles.sectionTitleEn}>Events</Text>
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
          {activeHook.loading && !activeHook.data ? (
            <LoadingInCard text="正在加载赛事..." />
          ) : activeHook.error ? (
            <CardText text="赛事列表加载失败" />
          ) : selectedRegions.length === 0 ? (
            <CardText text="请先选择赛区" />
          ) : filteredList.length === 0 ? (
            <CardText text="该赛区暂无赛事" />
          ) : (
            pagedRows.map((event, index) => (
              <EventRow
                key={`${event.id || "event"}-${startIndex + index}`}
                item={event}
                alt={index % 2 === 1}
                onPress={() => navigation.navigate("EventDetail", { eventId: event.id })}
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
            style={[styles.pageBtn, (!hasNextPage || activeHook.loading) && styles.pageBtnDisabled]}
            onPress={() => {
              if (!hasNextPage || activeHook.loading) return;
              if (tab === "upcoming") setUpcomingPage((p) => p + 1);
              else setCompletedPage((p) => p + 1);
            }}
            disabled={!hasNextPage || activeHook.loading}
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
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Matches")}>
            <IconImage uri={HOME_IMAGE_URLS.navMatchIcon} fallback="calendar-outline" size={20} />
          </Pressable>
          <Pressable style={[styles.navBtn, styles.navBtnActive]} onPress={() => navigation.navigate("Events")}>
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

function EventRow({ item, alt, onPress }: { item: EventListItem; alt?: boolean; onPress?: () => void }) {
  const iconUri = eventIconUri(item);
  return (
    <Pressable onPress={onPress} style={[styles.matchRow, alt && styles.matchRowAlt]}>
      {iconUri ? (
        <Image source={{ uri: iconUri }} style={styles.eventIcon} resizeMode="contain" />
      ) : (
        <View style={styles.eventIconFallback} />
      )}
      <View style={styles.eventMid}>
        <Text style={styles.eventName}>
          {item.name || "-"}
        </Text>
        <Text style={styles.eventDate}>{formatDateRange(item.start_date, item.end_date)}</Text>
      </View>
      <Text style={styles.eventRegion}>{eventEmoji(item)}</Text>
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

function formatDateRange(start?: string, end?: string) {
  const s = start || "-";
  const e = end || "-";
  return `${s}~${e}`;
}

function dateValue(value?: string) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function eventSortValue(event: EventListItem, mode: EventTab) {
  const start = dateValue(event.start_date);
  const end = dateValue(event.end_date);
  if (mode === "completed") return end || start;
  return start || end;
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
  if (!v) return HOME_IMAGE_URLS.regionDefaultIcon;
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

function detectEventRegion(event: EventListItem): RegionValue | "" {
  const src = `${event.region || ""} ${event.name || ""}`.toLowerCase();
  if (src.includes("americas")) return "americas";
  if (src.includes("emea")) return "emea";
  if (src.includes("pacific")) return "pacific";
  if (src.includes("china")) return "china";
  if (src.includes("masters")) return "masters";
  if (src.includes("champions") || src.includes("champs")) return "champions";
  return "";
}

function matchesRegion(event: EventListItem, selectedRegions: RegionValue[]) {
  if (selectedRegions.length === 0) return false;
  const region = detectEventRegion(event);
  return region ? selectedRegions.includes(region) : false;
}

function eventIconUri(event: EventListItem) {
  const detected = detectEventRegion(event);
  if (detected) return regionIconFor(detected);
  return regionIconFor(event.region || "");
}

function eventEmoji(event: EventListItem) {
  const src = `${event.region || ""} ${event.name || ""}`.toLowerCase();
  const map: Array<[string, string]> = [
    ["south korea", "🇰🇷"],
    ["korea", "🇰🇷"],
    ["japan", "🇯🇵"],
    ["china", "🇨🇳"],
    ["thailand", "🇹🇭"],
    ["singapore", "🇸🇬"],
    ["indonesia", "🇮🇩"],
    ["philippines", "🇵🇭"],
    ["united states", "🇺🇸"],
    ["usa", "🇺🇸"],
    ["canada", "🇨🇦"],
    ["brazil", "🇧🇷"],
    ["france", "🇫🇷"],
    ["germany", "🇩🇪"],
    ["spain", "🇪🇸"],
    ["turkey", "🇹🇷"],
    ["uk", "🇬🇧"],
    ["united kingdom", "🇬🇧"],
  ];
  for (const [k, emoji] of map) {
    if (src.includes(k)) return emoji;
  }
  if (src.includes("americas")) return "🌎";
  if (src.includes("emea")) return "🌍";
  if (src.includes("pacific")) return "🌏";
  if (src.includes("masters") || src.includes("champions") || src.includes("champs")) return "🗺️";
  return "🗺️";
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
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  matchRowAlt: {
    backgroundColor: "#cdcdcd",
  },
  eventIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  eventIconFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#bdbdbd",
  },
  eventMid: {
    flex: 1,
    gap: 3,
    paddingRight: 6,
  },
  eventName: {
    color: "#111827",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800",
  },
  eventDate: {
    color: "#4b5563",
    fontSize: 12,
    fontWeight: "700",
  },
  eventRegion: {
    color: "#111827",
    fontSize: 21,
    fontWeight: "700",
    width: 32,
    textAlign: "center",
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

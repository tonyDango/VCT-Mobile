import { Ionicons } from "@expo/vector-icons";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { CompositeNavigationProp, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlayerDirectoryItem, TeamSelectorRegion } from "../api/types";
import { getPlayerBasic, getTeamSelector } from "../api/vlrApi";
import { HOME_IMAGE_URLS, HOME_REGION_ICON_URLS } from "../config/homeConfig";
import { usePersistedAsyncData } from "../hooks/usePersistedAsyncData";
import { PERSIST_KEYS } from "../bootstrap/preload";
import { loadPersisted, savePersisted } from "../storage/persist";
import { buildRosterCacheKey, fetchPlayersFromRegionRosters, regionTeamsFromSelector } from "../players/rosters";
import { MainTabParamList, RootStackParamList } from "../navigation/types";

type RegionValue = "americas" | "emea" | "pacific" | "china";
type PlayerNav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

const REGION_OPTIONS: Array<{ value: RegionValue; icon: string }> = [
  { value: "americas", icon: HOME_REGION_ICON_URLS.Americas || HOME_IMAGE_URLS.regionDefaultIcon },
  { value: "emea", icon: HOME_REGION_ICON_URLS.EMEA || HOME_REGION_ICON_URLS.emea || HOME_IMAGE_URLS.regionDefaultIcon },
  { value: "pacific", icon: HOME_REGION_ICON_URLS.Pacific || HOME_IMAGE_URLS.regionDefaultIcon },
  { value: "china", icon: HOME_REGION_ICON_URLS.China || HOME_IMAGE_URLS.regionDefaultIcon },
];

const PLAYER_AVATAR_CACHE: Record<number, string | null> = {};
const PLAYER_AVATAR_INFLIGHT: Record<number, Promise<string | null>> = {};

/** 各赛区合并名单（内存缓存，避免离开页面再返回时重复打满队 roster 请求） */
const ROSTER_LIST_TTL_MS = 15 * 60 * 1000;
const rosterListCache = new Map<string, { savedAt: number; players: PlayerDirectoryItem[] }>();

function clonePlayerList(players: PlayerDirectoryItem[]) {
  return players.map((p) => ({
    ...p,
    current_teams: [...(p.current_teams || [])],
    history_teams: [...(p.history_teams || [])],
  }));
}

function getCachedRosterList(key: string): PlayerDirectoryItem[] | null {
  if (!key) return null;
  const hit = rosterListCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > ROSTER_LIST_TTL_MS) {
    rosterListCache.delete(key);
    return null;
  }
  return clonePlayerList(hit.players);
}

function setCachedRosterList(key: string, players: PlayerDirectoryItem[]) {
  if (!key) return;
  rosterListCache.set(key, { savedAt: Date.now(), players: clonePlayerList(players) });
}

function invalidateRosterListCache(key: string) {
  if (key) rosterListCache.delete(key);
}

export function PlayersScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<PlayerNav>();
  const [selectedRegion, setSelectedRegion] = useState<RegionValue>("americas");
  const [query, setQuery] = useState("");
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const teamSelectorHook = usePersistedAsyncData(PERSIST_KEYS.playersTeamSelector, () => getTeamSelector(4), []);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function seedAvatars() {
      const hit = await loadPersisted<Record<number, string | null>>("persist:players:avatars:v1");
      if (cancelled) return;
      if (hit?.data) {
        for (const [k, v] of Object.entries(hit.data)) {
          const id = Number(k);
          if (!Number.isFinite(id) || id <= 0) continue;
          if (PLAYER_AVATAR_CACHE[id] === undefined) {
            PLAYER_AVATAR_CACHE[id] = v ?? null;
          }
        }
        setAvatarMap((prev) => ({ ...hit.data, ...prev }));
      }
    }
    seedAvatars();
    return () => {
      cancelled = true;
    };
  }, []);

  const regionTeams = useMemo(() => {
    return regionTeamsFromSelector((teamSelectorHook.data?.items || []) as TeamSelectorRegion[], selectedRegion);
  }, [teamSelectorHook.data, selectedRegion]);

  const rosterCacheKey = useMemo(() => buildRosterCacheKey(selectedRegion, regionTeams), [selectedRegion, regionTeams]);

  const [rosterData, setRosterData] = useState<PlayerDirectoryItem[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  useEffect(() => {
    if (!rosterCacheKey || !regionTeams.length) {
      setRosterData(regionTeams.length === 0 && teamSelectorHook.data ? [] : null);
      setRosterLoading(false);
      setRosterError(null);
      return;
    }

    const cached = getCachedRosterList(rosterCacheKey);
    if (cached) {
      setRosterData(cached);
      setRosterLoading(false);
      setRosterError(null);
      return;
    }

    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);

    // 先读本地持久化（非内存缓存），再后台刷新写回
    loadPersisted<PlayerDirectoryItem[]>(`persist:players:roster:${rosterCacheKey}:v1`)
      .then((hit) => {
        if (cancelled) return;
        if (hit?.data?.length) {
          setCachedRosterList(rosterCacheKey, hit.data);
          setRosterData(hit.data);
          setRosterLoading(false);
        }
      })
      .finally(() => {
        // 无论是否命中，都刷新一次最新名单
        fetchPlayersFromRegionRosters(regionTeams)
      .then((list) => {
        if (cancelled) return;
        setCachedRosterList(rosterCacheKey, list);
        setRosterData(list);
        savePersisted(`persist:players:roster:${rosterCacheKey}:v1`, list, 1);
      })
      .catch((err) => {
        if (cancelled) return;
        setRosterError(err instanceof Error ? err.message : "请求失败");
        setRosterData(null);
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
      });

    return () => {
      cancelled = true;
    };
  }, [rosterCacheKey, regionTeams, teamSelectorHook.data]);

  const reloadRosters = useCallback(() => {
    invalidateRosterListCache(rosterCacheKey);
    if (!rosterCacheKey || !regionTeams.length) return;
    setRosterLoading(true);
    setRosterError(null);
    fetchPlayersFromRegionRosters(regionTeams)
      .then((list) => {
        setCachedRosterList(rosterCacheKey, list);
        setRosterData(list);
        savePersisted(`persist:players:roster:${rosterCacheKey}:v1`, list, 1);
      })
      .catch((err) => {
        setRosterError(err instanceof Error ? err.message : "请求失败");
        setRosterData(null);
      })
      .finally(() => setRosterLoading(false));
  }, [rosterCacheKey, regionTeams]);

  const players = useMemo(() => {
    const list = (rosterData || []) as PlayerDirectoryItem[];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((item) => {
      const src = `${item.ign || ""} ${item.real_name || ""} ${item.current_teams?.join(" ") || ""}`.toLowerCase();
      return src.includes(keyword);
    });
  }, [rosterData, query]);

  useEffect(() => {
    const ids = players.map((p) => p.player_id).filter((id): id is number => Number.isFinite(id));
    if (!ids.length) return;

    async function loadAvatars() {
      const missing = ids.filter((id) => PLAYER_AVATAR_CACHE[id] === undefined);
      if (missing.length) {
        await Promise.all(
          missing.map(async (id) => {
            const avatar = await loadPlayerAvatarCached(id);
            PLAYER_AVATAR_CACHE[id] = avatar;
          })
        );
      }

      const next: Record<number, string | null> = {};
      for (const id of ids) {
        next[id] = PLAYER_AVATAR_CACHE[id] ?? null;
      }
      setAvatarMap((prev) => {
        const changed = ids.some((id) => prev[id] !== next[id]);
        if (!changed) return prev;
        return { ...prev, ...next };
      });

      // 持久化：下次进入 Players 直接秒出头像
      const toSave: Record<number, string | null> = {};
      for (const id of ids) {
        toSave[id] = PLAYER_AVATAR_CACHE[id] ?? null;
      }
      const existing = (await loadPersisted<Record<number, string | null>>("persist:players:avatars:v1"))?.data || {};
      savePersisted("persist:players:avatars:v1", { ...existing, ...toSave }, 1);
    }

    loadAvatars();
  }, [players]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await teamSelectorHook.reload();
      reloadRosters();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={styles.safe}>
      <View style={[styles.content, { paddingTop: insets.top + 18 }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerIconWrap}>
            <LogoSquare uri={HOME_IMAGE_URLS.topAvatar} size={36} borderRadius={6} />
          </View>
          <View style={styles.searchWrap}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索选手"
              placeholderTextColor="#9ca3af"
              style={styles.searchInput}
            />
            <IconImage uri={HOME_IMAGE_URLS.searchIcon} fallback="search" size={18} />
          </View>
        </View>

        <View style={styles.regionWrap}>
          {REGION_OPTIONS.map((region) => (
            <Pressable
              key={region.value}
              onPress={() => setSelectedRegion(region.value)}
              style={[styles.regionBtn, selectedRegion === region.value && styles.regionBtnActive]}
            >
              <Image source={{ uri: region.icon }} style={styles.regionIcon} resizeMode="contain" />
            </Pressable>
          ))}
        </View>

        {teamSelectorHook.loading && !teamSelectorHook.data ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator size="small" color="#111827" />
            <Text style={styles.stateText}>正在加载赛区队伍...</Text>
          </View>
        ) : teamSelectorHook.error ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>赛区队伍加载失败</Text>
            <Pressable style={styles.retryBtn} onPress={teamSelectorHook.reload}>
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
          </View>
        ) : rosterLoading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator size="small" color="#111827" />
            <Text style={styles.stateText}>正在加载各队名单...</Text>
          </View>
        ) : rosterError ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>选手名单加载失败</Text>
            <Pressable style={styles.retryBtn} onPress={reloadRosters}>
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
          </View>
        ) : regionTeams.length === 0 ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>该赛区暂无队伍数据，请稍后重试</Text>
          </View>
        ) : (
          <FlatList
            data={players}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            keyExtractor={(item) => String(item.player_id)}
            numColumns={3}
            columnWrapperStyle={styles.gridRow}
            ListEmptyComponent={<Text style={styles.stateText}>该赛区暂无在役选手</Text>}
            renderItem={({ item, index }) => (
              <Pressable
                style={[styles.playerCell, index % 3 !== 2 && styles.playerCellGap]}
                onPress={() => navigation.navigate("PlayerDetail", { playerId: item.player_id })}
              >
                <AvatarCircle uri={avatarMap[item.player_id] || null} size={72} />
                <Text numberOfLines={1} style={styles.playerName}>
                  {item.ign || `Player ${item.player_id}`}
                </Text>
                <Text style={styles.playerCountry}>{countryEmoji(item.country)}</Text>
              </Pressable>
            )}
          />
        )}
      </View>

      <View style={styles.bottomBar}>
        <Pressable style={styles.homeBtn} onPress={() => navigation.navigate("Home")}>
          <IconImage uri={HOME_IMAGE_URLS.navHomeIcon} fallback="home" size={22} />
        </Pressable>
        <View style={styles.rightNav}>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Matches")}>
            <IconImage uri={HOME_IMAGE_URLS.navMatchIcon} fallback="calendar-outline" size={20} />
          </Pressable>
          <Pressable style={styles.navBtn} onPress={() => navigation.navigate("Events")}>
            <IconImage uri={HOME_IMAGE_URLS.navEventIcon} fallback="trophy-outline" size={20} />
          </Pressable>
          <Pressable style={[styles.navBtn, styles.navBtnActive]} onPress={() => navigation.navigate("Players")}>
            <IconImage uri={HOME_IMAGE_URLS.navPlayerIcon} fallback="people-outline" size={20} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

async function loadPlayerAvatarCached(playerId: number): Promise<string | null> {
  if (PLAYER_AVATAR_CACHE[playerId] !== undefined) return PLAYER_AVATAR_CACHE[playerId];
  if (!PLAYER_AVATAR_INFLIGHT[playerId]) {
    PLAYER_AVATAR_INFLIGHT[playerId] = getPlayerBasic(playerId)
      .then((data) => {
        const avatar = normalizeImageUrl((data?.avatar_url as string | undefined) || null);
        PLAYER_AVATAR_CACHE[playerId] = avatar;
        delete PLAYER_AVATAR_INFLIGHT[playerId];
        return avatar;
      })
      .catch(() => {
        PLAYER_AVATAR_CACHE[playerId] = null;
        delete PLAYER_AVATAR_INFLIGHT[playerId];
        return null;
      });
  }
  return PLAYER_AVATAR_INFLIGHT[playerId];
}

function normalizeImageUrl(raw?: string | null) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  return text;
}

function countryEmoji(country?: string) {
  const src = (country || "").toLowerCase();
  const map: Array<[string, string]> = [
    ["england", "🇬🇧"],
    ["hongkong", "🇨🇳"],
    ["hong kong", "🇨🇳"],
    ["taiwan", "🇨🇳"],
    ["chinese taipei", "🇨🇳"],
    ["south korea", "🇰🇷"],
    ["korea", "🇰🇷"],
    ["china", "🇨🇳"],
    ["japan", "🇯🇵"],
    ["thailand", "🇹🇭"],
    ["indonesia", "🇮🇩"],
    ["philippines", "🇵🇭"],
    ["singapore", "🇸🇬"],
    ["malaysia", "🇲🇾"],
    ["vietnam", "🇻🇳"],
    ["india", "🇮🇳"],
    ["australia", "🇦🇺"],
    ["new zealand", "🇳🇿"],
    ["united states", "🇺🇸"],
    ["usa", "🇺🇸"],
    ["canada", "🇨🇦"],
    ["brazil", "🇧🇷"],
    ["mexico", "🇲🇽"],
    ["argentina", "🇦🇷"],
    ["chile", "🇨🇱"],
    ["colombia", "🇨🇴"],
    ["france", "🇫🇷"],
    ["germany", "🇩🇪"],
    ["spain", "🇪🇸"],
    ["turkey", "🇹🇷"],
    ["united kingdom", "🇬🇧"],
    ["uk", "🇬🇧"],
    ["sweden", "🇸🇪"],
    ["finland", "🇫🇮"],
    ["denmark", "🇩🇰"],
    ["norway", "🇳🇴"],
    ["netherlands", "🇳🇱"],
    ["poland", "🇵🇱"],
    ["ukraine", "🇺🇦"],
    ["russia", "🇷🇺"],
  ];
  for (const [k, emoji] of map) {
    if (src.includes(k)) return emoji;
  }
  return "🌐";
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

function AvatarCircle({ uri, size }: { uri?: string | null; size: number }) {
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: "#d5d5d5",
  } as const;
  if (uri) return <Image source={{ uri }} style={style} resizeMode="cover" />;
  return <View style={style} />;
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#efefef",
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIconWrap: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flex: 1,
    backgroundColor: "#dedede",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  regionWrap: {
    marginTop: 14,
    alignSelf: "center",
    flexDirection: "row",
    backgroundColor: "#d7d7d7",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 10,
  },
  regionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  regionBtnActive: {
    backgroundColor: "#c8c8c8",
  },
  regionIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  list: {
    flex: 1,
    marginTop: 14,
  },
  listContent: {
    paddingBottom: 120,
    paddingTop: 4,
  },
  gridRow: {
    justifyContent: "flex-start",
    marginBottom: 14,
  },
  playerCell: {
    width: "31%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  playerCellGap: {
    marginRight: "3.5%",
  },
  playerName: {
    marginTop: 9,
    color: "#111827",
    fontSize: 15,
    fontWeight: "700",
    maxWidth: 90,
    textAlign: "center",
  },
  playerCountry: {
    marginTop: 2,
    color: "#111827",
    fontSize: 17,
  },
  stateWrap: {
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: "#d7d7d7",
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  stateText: {
    color: "#4b5563",
    fontSize: 13,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 2,
    borderRadius: 10,
    backgroundColor: "#c3c3c3",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryText: {
    color: "#111827",
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
});

import { Ionicons } from "@expo/vector-icons";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { CompositeNavigationProp, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlayerDirectoryItem, TeamSelectorRegion } from "../api/types";
import { getPlayerBasic, getPlayers, getTeamSelector } from "../api/vlrApi";
import { HOME_IMAGE_URLS, HOME_REGION_ICON_URLS } from "../config/homeConfig";
import { useAsyncData } from "../hooks/useAsyncData";
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

export function PlayersScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<PlayerNav>();
  const [selectedRegion, setSelectedRegion] = useState<RegionValue>("americas");
  const [query, setQuery] = useState("");
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const playersHook = useAsyncData(() => getPlayers("active", 240), []);
  const teamSelectorHook = useAsyncData(() => getTeamSelector(3), []);

  const teamRegionMap = useMemo(() => {
    const map: Record<string, RegionValue> = {};
    const rows = (teamSelectorHook.data?.items || []) as TeamSelectorRegion[];
    for (const row of rows) {
      const region = normalizeSelectorRegion(row.region);
      if (!region) continue;
      for (const team of row.teams || []) {
        const aliases = [team.name, team.tag].filter(Boolean) as string[];
        for (const alias of aliases) {
          map[normalizeNameKey(alias)] = region;
        }
      }
    }
    return map;
  }, [teamSelectorHook.data]);

  const players = useMemo(() => {
    const list = (playersHook.data?.items || []) as PlayerDirectoryItem[];
    const keyword = query.trim().toLowerCase();
    return list.filter((item) => {
      const region = detectPlayerRegion(item, teamRegionMap);
      if (region !== selectedRegion) return false;
      if (!keyword) return true;
      const src = `${item.ign || ""} ${item.real_name || ""} ${item.current_teams?.join(" ") || ""}`.toLowerCase();
      return src.includes(keyword);
    });
  }, [playersHook.data, selectedRegion, query, teamRegionMap]);

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
    }

    loadAvatars();
  }, [players]);

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

        {playersHook.loading && !playersHook.data ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator size="small" color="#111827" />
            <Text style={styles.stateText}>正在加载选手...</Text>
          </View>
        ) : playersHook.error ? (
          <View style={styles.stateWrap}>
            <Text style={styles.stateText}>选手列表加载失败</Text>
            <Pressable style={styles.retryBtn} onPress={playersHook.reload}>
              <Text style={styles.retryText}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={players}
            style={styles.list}
            contentContainerStyle={styles.listContent}
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

function detectPlayerRegion(player: PlayerDirectoryItem, teamRegionMap: Record<string, RegionValue>): RegionValue | "" {
  for (const teamName of player.current_teams || []) {
    const region = teamRegionMap[normalizeNameKey(teamName)];
    if (region) return region;
  }

  const country = (player.country || "").toLowerCase();
  if (!country) return "";
  if (country.includes("china")) return "china";

  const pacificWords = [
    "korea",
    "south korea",
    "japan",
    "thailand",
    "indonesia",
    "philippines",
    "singapore",
    "malaysia",
    "vietnam",
    "india",
    "australia",
    "new zealand",
    "taiwan",
    "hong kong",
  ];
  if (pacificWords.some((k) => country.includes(k))) return "pacific";

  const americasWords = [
    "united states",
    "usa",
    "canada",
    "brazil",
    "mexico",
    "argentina",
    "chile",
    "colombia",
    "peru",
    "uruguay",
    "ecuador",
    "bolivia",
    "paraguay",
    "venezuela",
    "costa rica",
    "dominican",
    "guatemala",
    "honduras",
    "panama",
  ];
  if (americasWords.some((k) => country.includes(k))) return "americas";

  return "emea";
}

function normalizeSelectorRegion(region?: string): RegionValue | "" {
  const src = (region || "").trim().toLowerCase();
  if (src.includes("china")) return "china";
  if (src.includes("pacific")) return "pacific";
  if (src.includes("americas")) return "americas";
  if (src.includes("emea")) return "emea";
  return "";
}

function normalizeNameKey(name?: string) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

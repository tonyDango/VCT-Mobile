import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useMemo } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { TeamSelectorRegion } from "../api/types";
import { HOME_IMAGE_URLS } from "../config/homeConfig";
import { useAsyncData } from "../hooks/useAsyncData";
import { RootStackParamList } from "../navigation/types";
import { getPlayerDetail, getTeamDetail, getTeamSelector } from "../api/vlrApi";

type PlayerDetailRoute = RouteProp<RootStackParamList, "PlayerDetail">;
type Nav = NativeStackNavigationProp<RootStackParamList>;

type PlayerProfile = {
  handle?: string;
  real_name?: string;
  country?: string;
  avatar_url?: string;
  current_teams?: Array<{ id?: number; name?: string; role?: string }>;
};

type CareerTotals = {
  rating?: number | null;
  acs?: number | null;
  kd_ratio?: number | null;
};

type AgentStatRow = {
  agent?: string;
  agent_image_url?: string;
  usage_count?: number | null;
  usage_percent?: number | null;
  rounds_played?: number | null;
  rating?: number | null;
  acs?: number | null;
  kd?: number | null;
  adr?: number | null;
};

type RecentMatchTeam = {
  name?: string;
  tag?: string;
};

type RecentMatchRow = {
  match_id?: number;
  player_team?: RecentMatchTeam;
  opponent_team?: RecentMatchTeam;
  phase?: string;
  stage?: string;
  player_score?: number | null;
  opponent_score?: number | null;
  date?: string;
  time?: string;
  time_text?: string;
};

export function PlayerDetailScreen() {
  const route = useRoute<PlayerDetailRoute>();
  const navigation = useNavigation<Nav>();
  const { playerId } = route.params;

  const detailHook = useAsyncData(() => getPlayerDetail(playerId), [playerId]);
  const profile = ((detailHook.data?.profile as PlayerProfile | undefined) || {}) as PlayerProfile;
  const totals = ((detailHook.data?.career_totals as CareerTotals | undefined) || {}) as CareerTotals;
  const agents = ((detailHook.data?.agent_stats as AgentStatRow[] | undefined) || []) as AgentStatRow[];
  const recentMatches = ((detailHook.data?.recent_matches as RecentMatchRow[] | undefined) || []) as RecentMatchRow[];
  const currentTeamId = profile.current_teams?.[0]?.id;

  const teamHook = useAsyncData(async () => {
    if (!currentTeamId) return null;
    return getTeamDetail(currentTeamId);
  }, [currentTeamId || 0]);

  const selectorHook = useAsyncData(() => getTeamSelector(3), []);
  const teamLogoMap = useMemo(() => {
    const map: Record<string, string> = {};
    const rows = (selectorHook.data?.items || []) as TeamSelectorRegion[];
    for (const row of rows) {
      for (const team of row.teams || []) {
        const logo = normalizeImageUrl(team.logo_url || null);
        if (!logo) continue;
        if (team.name) map[normalizeNameKey(team.name)] = logo;
        if (team.tag) map[`tag:${normalizeNameKey(team.tag)}`] = logo;
      }
    }
    return map;
  }, [selectorHook.data]);
  const currentTeamLogo = useMemo(() => {
    const fromTeamDetail = extractTeamLogo(teamHook.data);
    if (fromTeamDetail) return fromTeamDetail;
    const teamName = profile.current_teams?.[0]?.name;
    if (!teamName) return null;
    return teamLogoMap[normalizeNameKey(teamName)] || null;
  }, [teamHook.data, profile.current_teams, teamLogoMap]);

  return (
    <View style={styles.safe}>
      {detailHook.loading && !detailHook.data ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="small" color="#111827" />
        </View>
      ) : detailHook.error && !detailHook.data ? (
        <View style={styles.centerWrap}>
          <Text style={styles.hintText}>选手详情加载失败</Text>
          <Pressable style={styles.retryBtn} onPress={detailHook.reload}>
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerCard}>
            <AvatarCircle uri={normalizeImageUrl(profile.avatar_url)} size={92} />
            <View style={styles.headerInfo}>
              <Text style={styles.playerHandle}>{profile.handle || `Player #${playerId}`}</Text>
              <Text style={styles.playerMeta}>
                {profile.real_name || "-"} | {countryEmoji(profile.country)}
              </Text>
              <View style={styles.teamLine}>
                <Text style={styles.teamLineText}>{profile.current_teams?.[0]?.name || "-"}</Text>
                <AvatarCircle uri={currentTeamLogo} size={30} fallbackStyle={styles.teamLogoFallback} />
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>生涯总计</Text>
          <View style={styles.totalCard}>
            <MetricBubble label="ACS" value={formatNum(totals.acs, 1)} />
            <MetricBubble label="K:D" value={formatNum(totals.kd_ratio, 2)} />
            <MetricBubble label="Rating" value={formatNum(totals.rating, 2)} />
          </View>

          <Text style={styles.sectionTitle}>特工统计</Text>
          <View style={styles.agentCard}>
            <View style={styles.agentHeader}>
              <Text style={styles.agentHeaderLabel}> </Text>
              <Text style={styles.agentHeaderText}>USE</Text>
              <Text style={styles.agentHeaderText}>RND</Text>
              <Text style={styles.agentHeaderText}>Rating</Text>
              <Text style={styles.agentHeaderText}>ACS</Text>
              <Text style={styles.agentHeaderText}>K:D</Text>
              <Text style={styles.agentHeaderText}>ADR</Text>
            </View>
            {agents.slice(0, 6).map((row, index) => (
              <View key={`${row.agent || "agent"}-${index}`} style={[styles.agentRow, index % 2 === 1 && styles.agentRowAlt]}>
                <AvatarCircle uri={normalizeImageUrl(row.agent_image_url)} size={38} />
                <Text style={styles.agentCell}>{usageText(row.usage_count, row.usage_percent)}</Text>
                <Text style={styles.agentCell}>{asText(row.rounds_played)}</Text>
                <Text style={styles.agentCell}>{asText(row.rating)}</Text>
                <Text style={styles.agentCell}>{asText(row.acs)}</Text>
                <Text style={styles.agentCell}>{asText(row.kd)}</Text>
                <Text style={styles.agentCell}>{asText(row.adr)}</Text>
              </View>
            ))}
            {!agents.length && <Text style={styles.agentEmpty}>暂无特工数据</Text>}
          </View>

          <Text style={styles.sectionTitle}>近期比赛</Text>
          <View style={styles.listWrap}>
            {recentMatches.slice(0, 8).length === 0 ? (
              <View style={styles.cardCenter}>
                <Text style={styles.cardCenterText}>暂无近期比赛</Text>
              </View>
            ) : (
              recentMatches.slice(0, 8).map((match, index) => {
                const row = toMatchRow(match, teamLogoMap);
                return (
                  <MatchRow
                    key={`${match.match_id || "recent"}-${index}`}
                    team1={row.team1}
                    team2={row.team2}
                    boText={row.boText}
                    rightTop={row.scoreText}
                    rightBottom={row.dateText}
                    alt={index % 2 === 1}
                    onPress={() => {
                      if (match.match_id) navigation.navigate("MatchDetail", { matchId: match.match_id });
                    }}
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

function MetricBubble({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricItem}>
      <View style={styles.metricCircle}>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MatchRow({
  team1,
  team2,
  boText,
  rightTop,
  rightBottom,
  alt,
  onPress,
}: {
  team1: { name?: string; logoUri?: string | null };
  team2: { name?: string; logoUri?: string | null };
  boText: string;
  rightTop: string;
  rightBottom: string;
  alt?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.matchRow, alt && styles.matchRowAlt]}>
      <View style={styles.rowLeft}>
        <View style={styles.matchTeamLine}>
          <LogoSquare uri={team1.logoUri || HOME_IMAGE_URLS.defaultLogo} />
          <Text style={styles.matchTeamText}>{team1.name || "-"}</Text>
        </View>
        <View style={styles.matchTeamLine}>
          <LogoSquare uri={team2.logoUri || HOME_IMAGE_URLS.defaultLogo} />
          <Text style={styles.matchTeamText}>{team2.name || "-"}</Text>
        </View>
      </View>
      <Text style={styles.rowBo}>{boText}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowScore}>{rightTop}</Text>
        <Text numberOfLines={1} style={styles.rowDate}>
          {rightBottom}
        </Text>
      </View>
    </Pressable>
  );
}

function AvatarCircle({
  uri,
  size,
  fallbackStyle,
}: {
  uri?: string | null;
  size: number;
  fallbackStyle?: object;
}) {
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: "#dfdfdf",
  } as const;
  if (uri) return <Image source={{ uri }} style={style} resizeMode="cover" />;
  return <View style={[style, fallbackStyle]} />;
}

function LogoSquare({ uri, size = 32 }: { uri?: string | null; size?: number }) {
  const style = { width: size, height: size, borderRadius: 6, backgroundColor: "transparent" } as const;
  if (uri) return <Image source={{ uri }} style={style} resizeMode="contain" />;
  return <View style={style} />;
}

function toMatchRow(match: RecentMatchRow, teamLogoMap: Record<string, string>) {
  const team1Name = match.player_team?.name || "-";
  const team2Name = match.opponent_team?.name || "-";
  const team1Logo = pickLogoFromMap(teamLogoMap, team1Name, match.player_team?.tag);
  const team2Logo = pickLogoFromMap(teamLogoMap, team2Name, match.opponent_team?.tag);
  const s1 = Number.isFinite(match.player_score) ? Number(match.player_score) : null;
  const s2 = Number.isFinite(match.opponent_score) ? Number(match.opponent_score) : null;
  return {
    team1: { name: team1Name, logoUri: team1Logo },
    team2: { name: team2Name, logoUri: team2Logo },
    boText: displayBestOf(match),
    scoreText: s1 === null || s2 === null ? "-" : `${s1} : ${s2}`,
    dateText: formatRecentDateTime(match),
  };
}

function pickLogoFromMap(map: Record<string, string>, name?: string, tag?: string) {
  const byTag = tag ? map[`tag:${normalizeNameKey(tag)}`] : undefined;
  if (byTag) return byTag;
  const byName = name ? map[normalizeNameKey(name)] : undefined;
  if (byName) return byName;
  return null;
}

function displayBestOf(match: RecentMatchRow) {
  const direct = formatSeries(`${match.stage || ""} ${match.phase || ""}`);
  if (direct !== "BO ?") return direct;
  const phaseText = `${match.phase || ""} ${match.stage || ""}`.toLowerCase();
  if (/grand final|lower final|upper final|final/.test(phaseText)) return "BO 5";
  return "BO 3";
}

function formatSeries(series?: string) {
  if (!series) return "BO ?";
  const text = String(series).toUpperCase().replace(/\s+/g, " ").trim();
  const m = text.match(/BO\s*([1-9])/);
  if (m?.[1]) return `BO ${m[1]}`;
  return "BO ?";
}

function formatRecentDateTime(match: RecentMatchRow) {
  const rawDate = (match.date || "").trim();
  if (!rawDate) return "-";
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return rawDate;
  const month = parsed.toLocaleString("en-US", { month: "short" });
  const day = parsed.getDate();
  const timeText = normalizeTimeText(match.time || match.time_text);
  return `${month} ${day} ${timeText}`;
}

function normalizeTimeText(time?: string) {
  if (!time) return "--:--";
  const src = String(time).trim();
  const m = src.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return src.slice(0, 5);
  let hh = Number(m[1]);
  const mm = m[2];
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${mm}`;
}

function usageText(count?: number | null, usage?: number | null) {
  const c = Number.isFinite(count) ? Number(count) : 0;
  const p = Number.isFinite(usage) ? `${Math.round(Number(usage) * 100)}%` : "-";
  return `(${c}) ${p}`;
}

function asText(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

function formatNum(value: unknown, digits: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function normalizeImageUrl(raw?: string | null) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  return text;
}

function normalizeNameKey(name?: string) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractTeamLogo(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  const info = (payload.info as Record<string, unknown> | undefined) || {};
  return normalizeImageUrl((info.logo_url as string | undefined) || null);
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
    ["france", "🇫🇷"],
    ["germany", "🇩🇪"],
    ["spain", "🇪🇸"],
    ["turkey", "🇹🇷"],
    ["united kingdom", "🇬🇧"],
    ["uk", "🇬🇧"],
  ];
  for (const [k, emoji] of map) {
    if (src.includes(k)) return emoji;
  }
  return "🌐";
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#efefef",
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#efefef",
    paddingHorizontal: 16,
  },
  hintText: {
    color: "#4b5563",
    fontSize: 13,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 10,
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
  headerCard: {
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  playerHandle: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
  },
  playerMeta: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "700",
  },
  teamLine: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  teamLineText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "700",
  },
  teamLogoFallback: {
    backgroundColor: "#e4e4e4",
  },
  sectionTitle: {
    marginTop: 22,
    marginBottom: 10,
    color: "#111827",
    fontWeight: "700",
    fontSize: 15,
  },
  totalCard: {
    borderRadius: 22,
    backgroundColor: "#d7d7d7",
    paddingHorizontal: 12,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricItem: {
    width: "32%",
    alignItems: "center",
  },
  metricCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#efefef",
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    color: "#111827",
    fontWeight: "800",
    fontSize: 14,
  },
  metricLabel: {
    marginTop: 8,
    color: "#111827",
    fontWeight: "700",
    fontSize: 13,
  },
  agentCard: {
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#d7d7d7",
  },
  agentHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  agentHeaderLabel: {
    width: 40,
  },
  agentHeaderText: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
    fontSize: 12,
    textAlign: "center",
  },
  agentRow: {
    minHeight: 62,
    backgroundColor: "#d7d7d7",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  agentRowAlt: {
    backgroundColor: "#cdcdcd",
  },
  agentCell: {
    flex: 1,
    color: "#111827",
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },
  agentEmpty: {
    color: "#4b5563",
    textAlign: "center",
    paddingVertical: 16,
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
  matchTeamLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  matchTeamText: {
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

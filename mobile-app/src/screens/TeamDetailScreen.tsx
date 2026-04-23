import { RouteProp, useRoute } from "@react-navigation/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  ScreenContainer,
  commonStyles,
} from "../components/Common";
import { useAsyncData } from "../hooks/useAsyncData";
import { RootStackParamList } from "../navigation/types";
import { getTeamDetail } from "../api/vlrApi";

type TeamDetailRoute = RouteProp<RootStackParamList, "TeamDetail">;

export function TeamDetailScreen() {
  const route = useRoute<TeamDetailRoute>();
  const { teamId } = route.params;
  const { data, loading, error, reload } = useAsyncData(() => getTeamDetail(teamId), [teamId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState message="未找到俱乐部详情" />;

  const info = (data.info as Record<string, unknown>) || {};
  const roster = (data.roster as Array<Record<string, unknown>>) || [];
  const upcoming = (data.upcoming_matches as Array<Record<string, unknown>>) || [];
  const completed = (data.completed_matches as Array<Record<string, unknown>>) || [];

  return (
    <ScreenContainer>
      <ScrollView>
        <Card>
          <Text style={commonStyles.title}>{String(info.name || `Team #${teamId}`)}</Text>
          <Text style={commonStyles.subtitle}>{String(info.country || "-")}</Text>
          <Text style={styles.infoLine}>状态：{info.is_active ? "现役" : "过往"}</Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>现役成员</Text>
          {roster.filter((x) => String(x.role || "").toLowerCase() === "player").map((member, idx) => (
            <View style={styles.row} key={`${member.player_id || "player"}-${idx}`}>
              <Text style={styles.rowLeft}>{String(member.ign || "-")}</Text>
              <Text style={styles.rowRight}>{String(member.country || "-")}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>未来赛程（Top 8）</Text>
          {upcoming.slice(0, 8).map((item, idx) => (
            <View style={styles.row} key={`${item.match_id || "up"}-${idx}`}>
              <Text style={styles.rowLeft}>
                {String((item.team1 as Record<string, unknown>)?.name || "-")} vs {String((item.team2 as Record<string, unknown>)?.name || "-")}
              </Text>
              <Text style={styles.rowRight}>{String(item.match_datetime || "-")}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>近期战绩（Top 8）</Text>
          {completed.slice(0, 8).map((item, idx) => (
            <View style={styles.row} key={`${item.match_id || "cp"}-${idx}`}>
              <Text style={styles.rowLeft}>
                {String((item.team1 as Record<string, unknown>)?.name || "-")} vs {String((item.team2 as Record<string, unknown>)?.name || "-")}
              </Text>
              <Text style={styles.rowRight}>{String(item.match_datetime || "-")}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  infoLine: {
    marginTop: 6,
    color: "#4b5563",
  },
  sectionTitle: {
    fontWeight: "700",
    fontSize: 16,
    marginBottom: 8,
    color: "#111827",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    paddingVertical: 6,
    gap: 8,
  },
  rowLeft: {
    flex: 1,
    color: "#111827",
  },
  rowRight: {
    color: "#374151",
    fontSize: 12,
  },
});

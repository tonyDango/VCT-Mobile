import { useState } from "react";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SearchPlayerResult, SearchTeamResult } from "../api/types";
import { searchEntities } from "../api/vlrApi";
import {
  Card,
  EmptyState,
  ErrorState,
  FilterRow,
  LoadingState,
  ScreenContainer,
  commonStyles,
} from "../components/Common";
import { RootStackParamList } from "../navigation/types";

type SearchType = "all" | "players" | "teams";
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SearchType>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<SearchPlayerResult[]>([]);
  const [teams, setTeams] = useState<SearchTeamResult[]>([]);

  async function doSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchEntities(query.trim(), type);
      setPlayers(res.players ?? []);
      setTeams(res.teams ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  }

  const merged = [
    ...players.map((item) => ({ ...item, _kind: "player" as const })),
    ...teams.map((item) => ({ ...item, _kind: "team" as const })),
  ];

  return (
    <ScreenContainer>
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索选手或俱乐部"
          style={styles.input}
          onSubmitEditing={doSearch}
          returnKeyType="search"
        />
        <Pressable onPress={doSearch} style={styles.searchBtn}>
          <Text style={styles.searchBtnText}>搜索</Text>
        </Pressable>
      </View>
      <FilterRow
        value={type}
        onChange={setType}
        options={[
          { label: "全部", value: "all" },
          { label: "选手", value: "players" },
          { label: "俱乐部", value: "teams" },
        ]}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={doSearch} />
      ) : (
        <FlatList
          data={merged}
          keyExtractor={(item) => `${item._kind}-${item._kind === "player" ? item.player_id : item.team_id}`}
          ListEmptyComponent={<EmptyState message="输入关键词开始搜索" />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                if (item._kind === "player") navigation.navigate("PlayerDetail", { playerId: item.player_id });
                if (item._kind === "team") navigation.navigate("TeamDetail", { teamId: item.team_id });
              }}
            >
              <Card>
                {item._kind === "player" ? (
                  <View>
                    <Text style={commonStyles.title}>{item.ign || `Player #${item.player_id}`}</Text>
                    <Text style={styles.meta}>{item.real_name || "-"} | {item.country || "-"}</Text>
                  </View>
                ) : (
                  <View>
                    <Text style={commonStyles.title}>{item.name || `Team #${item.team_id}`}</Text>
                    <Text style={styles.meta}>{item.country || "-"} | {item.is_inactive ? "过往" : "现役"}</Text>
                  </View>
                )}
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchBtn: {
    backgroundColor: "#ff4655",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchBtnText: {
    color: "white",
    fontWeight: "700",
  },
  meta: {
    marginTop: 6,
    color: "#4b5563",
  },
});

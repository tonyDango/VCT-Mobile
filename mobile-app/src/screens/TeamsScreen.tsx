import { useState } from "react";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { FlatList, Pressable, StyleSheet, Text } from "react-native";

import { TeamDirectoryItem } from "../api/types";
import { getTeams } from "../api/vlrApi";
import {
  Card,
  EmptyState,
  ErrorState,
  FilterRow,
  LoadingState,
  ScreenContainer,
  commonStyles,
} from "../components/Common";
import { useAsyncData } from "../hooks/useAsyncData";
import { RootStackParamList } from "../navigation/types";

type TeamFilter = "all" | "active" | "inactive";
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TeamsScreen() {
  const [status, setStatus] = useState<TeamFilter>("active");
  const navigation = useNavigation<Nav>();
  const { data, loading, error, reload } = useAsyncData(() => getTeams(status, 60), [status]);
  const list = data?.items ?? [];

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <ScreenContainer>
      <FilterRow
        value={status}
        onChange={setStatus}
        options={[
          { label: "全部", value: "all" },
          { label: "现役", value: "active" },
          { label: "过往", value: "inactive" },
        ]}
      />
      <FlatList
        data={list}
        keyExtractor={(item) => String(item.team_id)}
        ListEmptyComponent={<EmptyState message="暂无俱乐部数据" />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("TeamDetail", { teamId: item.team_id })}>
            <TeamCard item={item} />
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}

function TeamCard({ item }: { item: TeamDirectoryItem }) {
  return (
    <Card>
      <Text style={commonStyles.title}>{item.name}</Text>
      <Text style={styles.meta}>{item.country || "-"}</Text>
      <Text style={styles.meta}>状态：{item.is_active ? "现役" : "过往"}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  meta: {
    marginTop: 6,
    color: "#4b5563",
  },
});

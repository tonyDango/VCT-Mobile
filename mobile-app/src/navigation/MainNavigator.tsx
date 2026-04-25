import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { EventDetailScreen } from "../screens/EventDetailScreen";
import { EventsScreen } from "../screens/EventsScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { MatchDetailScreen } from "../screens/MatchDetailScreen";
import { MatchesScreen } from "../screens/MatchesScreen";
import { BootstrapScreen } from "../screens/BootstrapScreen";
import { PlayerDetailScreen } from "../screens/PlayerDetailScreen";
import { PlayersScreen } from "../screens/PlayersScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { TeamDetailScreen } from "../screens/TeamDetailScreen";
import { MainTabParamList, RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function iconName(route: keyof MainTabParamList, focused: boolean): keyof typeof Ionicons.glyphMap {
  if (route === "Home") return focused ? "home" : "home-outline";
  if (route === "Matches") return focused ? "calendar" : "calendar-outline";
  if (route === "Events") return focused ? "trophy" : "trophy-outline";
  return focused ? "people" : "people-outline";
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: "#ff4655",
        tabBarInactiveTintColor: "#6b7280",
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={iconName(route.name as keyof MainTabParamList, focused)} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: "Home", tabBarStyle: { display: "none" } }}
      />
      <Tab.Screen
        name="Matches"
        component={MatchesScreen}
        options={{ title: "比赛", tabBarStyle: { display: "none" } }}
      />
      <Tab.Screen
        name="Events"
        component={EventsScreen}
        options={{ title: "赛事", tabBarStyle: { display: "none" } }}
      />
      <Tab.Screen
        name="Players"
        component={PlayersScreen}
        options={{ title: "选手", tabBarStyle: { display: "none" } }}
      />
    </Tab.Navigator>
  );
}

export default function MainNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} options={{ headerShown: false }} />
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ title: "搜索" }} />
        <Stack.Screen name="MatchDetail" component={MatchDetailScreen} options={{ title: "比赛详情" }} />
        <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ title: "赛事详情" }} />
        <Stack.Screen name="PlayerDetail" component={PlayerDetailScreen} options={{ title: "选手详情" }} />
        <Stack.Screen name="TeamDetail" component={TeamDetailScreen} options={{ title: "俱乐部详情" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

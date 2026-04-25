export type RootStackParamList = {
  Bootstrap: undefined;
  MainTabs: undefined;
  Search: undefined;
  MatchDetail: { matchId: number };
  EventDetail: { eventId: number };
  PlayerDetail: { playerId: number };
  TeamDetail: { teamId: number };
};

export type MainTabParamList = {
  Home: undefined;
  Matches: undefined;
  Events: undefined;
  Players: undefined;
};

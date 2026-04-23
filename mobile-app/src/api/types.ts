export interface ApiPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface ApiListResponse<T> {
  items: T[];
  pagination?: ApiPagination;
}

export interface MatchTeam {
  id?: number;
  name?: string;
  tag?: string | null;
  logo?: string | null;
  country?: string;
  score?: number | null;
}

export interface MatchListItem {
  match_id: number;
  status: string;
  event: string;
  event_phase: string;
  date?: string;
  time?: string;
  team1: MatchTeam;
  team2: MatchTeam;
}

export interface SeriesInfo {
  match_id: number;
  event: string;
  event_phase: string;
  status_note: string;
  best_of?: string;
  date?: string;
  time?: string;
  score?: [number | null, number | null];
}

export interface PlayerStatsRow {
  player_id?: number;
  name: string;
  team_short?: string;
  team_id?: number;
  country?: string;
  agents?: string[];
  r?: number;
  acs?: number;
  adr?: number;
  kast?: number;
  hs_pct?: number;
  k?: number;
  d?: number;
  a?: number;
  kd_diff?: number;
}

export interface MatchMapTeamScore {
  id?: number;
  name?: string;
  short?: string;
  score?: number | null;
  is_winner?: boolean;
  attacker_rounds?: number | null;
  defender_rounds?: number | null;
}

export interface MatchMapStats {
  map_name: string;
  players: PlayerStatsRow[];
  teams?: [MatchMapTeamScore, MatchMapTeamScore] | null;
}

export interface MatchDetailTeam {
  id?: number;
  name?: string;
  short?: string;
  tag?: string | null;
  country?: string | null;
  score?: number | null;
  logo_url?: string | null;
}

export interface MatchDetailResponse {
  info: SeriesInfo;
  event_image_url?: string | null;
  teams?: MatchDetailTeam[];
  total_stats?: MatchMapStats;
  maps: MatchMapStats[];
}

export interface EventListItem {
  id: number;
  name: string;
  status: "upcoming" | "ongoing" | "completed";
  region?: string;
  start_date?: string;
  end_date?: string;
  prize?: string;
}

export interface EventMatchItem {
  match_id: number;
  status: string;
  stage?: string;
  phase?: string;
  date?: string;
  time?: string;
  teams: MatchTeam[];
}

export interface EventStatsRow {
  rank: number;
  player_id?: number;
  name: string;
  team_short?: string;
  matches_played: number;
  r?: number;
  acs?: number;
  adr?: number;
  kast?: number;
  hs_pct?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  kd_ratio?: number;
}

export interface PlayerDirectoryItem {
  player_id: number;
  ign?: string;
  real_name?: string;
  country?: string;
  status: "active" | "retired";
  current_teams: string[];
  history_teams: string[];
}

export interface TeamDirectoryItem {
  team_id: number;
  name: string;
  tag?: string;
  country?: string;
  is_active: boolean;
  logo_url?: string;
}

export interface TeamRosterMember {
  role: string;
  player_id?: number;
  ign?: string;
  real_name?: string;
  country?: string;
}

export interface TeamScheduleMatch {
  match_id?: number;
  tournament_name?: string;
  phase?: string;
  series?: string;
  match_datetime?: string;
  team1?: MatchTeam;
  team2?: MatchTeam;
}

export interface SearchPlayerResult {
  player_id: number;
  ign?: string;
  real_name?: string;
  country?: string;
}

export interface SearchTeamResult {
  team_id: number;
  name?: string;
  country?: string;
  is_inactive?: boolean;
}

export interface SearchResultsResponse {
  query: string;
  players?: SearchPlayerResult[];
  teams?: SearchTeamResult[];
  events?: Array<{ event_id: number; name?: string }>;
  series?: Array<{ series_id: number; name?: string }>;
}

export interface HomeVctMatchItem {
  match_id: number;
  status: "upcoming" | "completed";
  event_name?: string;
  phase?: string;
  match_datetime?: string;
  best_of?: string | null;
  team1?: MatchTeam;
  team2?: MatchTeam;
}

export interface HomeVctMatchesResponse {
  items: HomeVctMatchItem[];
  page?: number;
  limit?: number;
  has_prev?: boolean;
  has_next?: boolean;
}

export interface TeamSelectorTeam {
  team_id: number;
  name: string;
  logo_url?: string | null;
  country?: string | null;
  tag?: string | null;
}

export interface TeamSelectorRegion {
  region: string;
  teams: TeamSelectorTeam[];
}

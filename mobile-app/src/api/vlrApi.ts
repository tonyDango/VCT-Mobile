import { apiGet, withQuery } from "./client";
import {
  ApiListResponse,
  EventListItem,
  EventMatchItem,
  EventStatsRow,
  HomeVctMatchesResponse,
  HomeVctMatchItem,
  MatchDetailResponse,
  MatchListItem,
  PlayerDirectoryItem,
  SearchResultsResponse,
  TeamSelectorRegion,
  TeamDirectoryItem,
} from "./types";

export async function getUpcomingMatches(limit = 30) {
  return apiGet<{ items: MatchListItem[] }>(withQuery("/match/upcoming", { limit }));
}

export async function getHistoryMatches(limit = 30) {
  return apiGet<{ items: MatchListItem[] }>(withQuery("/match/history", { limit }));
}

export async function getLiveMatches(limit = 20) {
  return apiGet<{ items: MatchListItem[] }>(withQuery("/match/live", { limit }));
}

export async function getMatchDetail(matchId: number) {
  return apiGet<MatchDetailResponse>(`/match/${matchId}`);
}

export async function getEvents(status: "all" | "ongoing" | "upcoming" | "completed", limit = 30) {
  return apiGet<{ items: EventListItem[] }>(withQuery("/event/", { status, limit }));
}

export async function getEventDetail(eventId: number) {
  return apiGet<Record<string, unknown>>(`/event/${eventId}`);
}

export async function getEventMatches(eventId: number, status?: string) {
  return apiGet<{ items: EventMatchItem[] }>(withQuery(`/event/${eventId}/matches`, { status }));
}

export async function getEventStats(eventId: number, sortBy: string) {
  return apiGet<{ items: EventStatsRow[] }>(withQuery(`/event/${eventId}/stats`, { sort_by: sortBy, order: "desc" }));
}

export async function getPlayers(
  status: "all" | "active" | "retired",
  pageSize = 50,
  maxEventPages = 1
) {
  return apiGet<ApiListResponse<PlayerDirectoryItem>>(
    withQuery("/player/", { status, page_size: pageSize, max_event_pages: maxEventPages })
  );
}

export async function getPlayerDetail(playerId: number) {
  return apiGet<Record<string, unknown>>(`/player/${playerId}`);
}

export async function getPlayerBasic(playerId: number) {
  return apiGet<Record<string, unknown>>(`/player/${playerId}/basic`);
}

export async function getTeams(
  status: "all" | "active" | "inactive",
  pageSize = 50,
  maxEventPages = 1
) {
  return apiGet<ApiListResponse<TeamDirectoryItem>>(
    withQuery("/team/", { status, page_size: pageSize, max_event_pages: maxEventPages })
  );
}

export async function getTeamDetail(teamId: number) {
  return apiGet<Record<string, unknown>>(`/team/${teamId}`);
}

export async function getHomeVctMatches(
  status: "upcoming" | "completed",
  limit = 5,
  maxEventPages = 1,
  page = 1
) {
  return apiGet<HomeVctMatchesResponse>(
    withQuery("/match/vct", { status, limit, max_event_pages: maxEventPages, page })
  );
}

export async function getTeamSelector(maxEventPages = 1) {
  return apiGet<{ items: TeamSelectorRegion[] }>(
    withQuery("/team/selector", { max_event_pages: maxEventPages })
  );
}

export async function searchEntities(query: string, type: "all" | "players" | "teams" = "all") {
  return apiGet<SearchResultsResponse>(withQuery("/search/", { q: query, type }));
}

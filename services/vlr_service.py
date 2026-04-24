from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, is_dataclass, replace
from datetime import date, datetime, time, timedelta
from functools import lru_cache
import importlib
import re
from typing import Any

import vlrdevapi as vlr
from dateutil import parser as dateutil_parser
from vlrdevapi.utils import split_date_range

# `vlrdevapi.events` 在包上挂有同名 `info` 函数，勿用 `import vlrdevapi.events.info` 避免拿到函数
vlr_event_info = importlib.import_module("vlrdevapi.events.info")

# vlrdevapi: event info 仅识别 "Dec 17 - 22, 2025" 单格式；"Mar 13, 2025 - May 5, 2025" 会失败，
# 列表页再解析无年份日期时会默认成「当前年」（易全部显示为 2026）。此处扩展解析后替换库内方法。
_VLR_EVENT_MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _parse_vlr_event_date_text(date_text: str | None) -> tuple[date | None, date | None]:
    """与 VLR 赛事页 Dates 一致：支持同月、跨月、带完整年份起止等。"""

    if not date_text:
        return None, None
    raw = date_text.replace("—", "-").replace("–", "-").strip()
    if not raw or raw.lower() in ("tbd", "to be announced", "tba", "n/a"):
        return None, None

    m = re.match(
        r"^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$",
        raw,
    )
    if m:
        month_abbr, start_day, end_day, y = m.groups()
        month_num = _VLR_EVENT_MONTHS.get(month_abbr.lower())
        if month_num is None:
            return None, None
        try:
            y_int = int(y)
            s_d = int(start_day)
            e_d = int(end_day)
            s = date(y_int, month_num, s_d)
            e = date(y_int, month_num, e_d)
            return s, e
        except (ValueError, TypeError):
            return None, None

    start_part, end_part = split_date_range(raw)
    if not start_part:
        return None, None
    if not end_part:
        try:
            d = dateutil_parser.parse(start_part, fuzzy=False).date()
            return d, d
        except (ValueError, TypeError, dateutil_parser.ParserError):
            return None, None

    if not re.search(r",\s*\d{4}\s*$", end_part):
        return None, None
    try:
        end_parsed = dateutil_parser.parse(end_part, fuzzy=False).date()
    except (ValueError, TypeError, dateutil_parser.ParserError):
        return None, None

    if re.search(r",\s*\d{4}\s*$", start_part):
        try:
            start_parsed = dateutil_parser.parse(start_part, fuzzy=False).date()
        except (ValueError, TypeError, dateutil_parser.ParserError):
            return None, None
    else:
        y = end_parsed.year
        try:
            s_try = dateutil_parser.parse(f"{start_part}, {y}", fuzzy=False).date()
        except (ValueError, TypeError, dateutil_parser.ParserError):
            return None, None
        if s_try > end_parsed:
            start_parsed = dateutil_parser.parse(
                f"{start_part}, {y - 1}", fuzzy=False
            ).date()
        else:
            start_parsed = s_try

    return start_parsed, end_parsed


_original_event_info = vlr_event_info.info


def _event_info_repair_dates(event_id: int, timeout: float | None = None) -> Any:
    """
    vlr 的 info 对跨月/双端完整年份的 Dates 常解析为 None，列表会退回无年份解析成「当前年」。
    在拿到页面 date_text 后用同一套规则补全 start/end。
    """
    out = _original_event_info(event_id=event_id, timeout=timeout)
    if out is None or not out.date_text:
        return out
    s, e = _parse_vlr_event_date_text(out.date_text)
    if s is not None and e is not None:
        return replace(out, start_date=s, end_date=e)
    return out


vlr_event_info.info = _event_info_repair_dates
import vlrdevapi.events as _vlr_events_pkg

_vlr_events_pkg.info = _event_info_repair_dates
# 包上同时挂有同名 `list_events` 函数，勿用 import … list_events 以免拿到函数而非模块
_vlr_list_events_mod = importlib.import_module("vlrdevapi.events.list_events")
_vlr_list_events_mod.get_event_info = _event_info_repair_dates

_DIRECTORY_CACHE: dict[str, dict[str, Any]] = {}
_CACHE_TTL_SECONDS = 30 * 60

_NUMERIC_SUM_FIELDS = ("k", "d", "a", "fk", "fd", "kd_diff", "fk_diff")
_NUMERIC_AVG_FIELDS = ("r", "acs", "adr", "kast", "hs_pct")


def _now_ts() -> float:
    return datetime.utcnow().timestamp()


def _get_cache(key: str, refresh: bool = False) -> Any | None:
    if refresh:
        return None
    cached = _DIRECTORY_CACHE.get(key)
    if not cached:
        return None
    if _now_ts() - cached["ts"] > _CACHE_TTL_SECONDS:
        return None
    return cached["value"]


def _set_cache(key: str, value: Any) -> None:
    _DIRECTORY_CACHE[key] = {"ts": _now_ts(), "value": value}


def to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        value = asdict(value)
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def _safe_parse_time(time_text: str | None) -> time:
    if not time_text:
        return time(0, 0)
    for fmt in ("%I:%M %p", "%H:%M"):
        try:
            return datetime.strptime(time_text.strip(), fmt).time()
        except ValueError:
            continue
    return time(0, 0)


def _match_dt_key(match_obj: Any) -> datetime:
    match_date = getattr(match_obj, "date", None) or date(1970, 1, 1)
    match_time = _safe_parse_time(getattr(match_obj, "time", None))
    return datetime.combine(match_date, match_time)


def _event_match_dt_key(match_obj: Any) -> datetime:
    match_date = getattr(match_obj, "date", None) or date(1970, 1, 1)
    match_time = _safe_parse_time(getattr(match_obj, "time", None))
    return datetime.combine(match_date, match_time)


def _score_missing(score_value: Any) -> bool:
    if not isinstance(score_value, (list, tuple)) or len(score_value) < 2:
        return True
    return score_value[0] is None and score_value[1] is None


def _compact_match_snapshot(src: Any) -> dict[str, Any] | None:
    if src is None:
        return None

    if isinstance(src, dict):
        team1 = src.get("team1") or {}
        team2 = src.get("team2") or {}
        score = [team1.get("score"), team2.get("score")]
        return {
            "match_id": src.get("match_id"),
            "status": src.get("status"),
            "best_of": src.get("best_of"),
            "date": src.get("date"),
            "time": src.get("time"),
            "score": score,
            "team1": team1,
            "team2": team2,
        }

    team1 = getattr(src, "team1", None)
    team2 = getattr(src, "team2", None)
    return {
        "match_id": getattr(src, "match_id", None),
        "status": getattr(src, "status", None),
        "best_of": _normalize_best_of(getattr(src, "series", None), getattr(src, "event_phase", None)),
        "date": getattr(src, "date", None),
        "time": getattr(src, "time", None),
        "score": [getattr(team1, "score", None), getattr(team2, "score", None)],
        "team1": {
            "id": getattr(team1, "id", None),
            "name": getattr(team1, "name", None),
            "tag": getattr(team1, "tag", None) or getattr(team1, "short", None),
            "score": getattr(team1, "score", None),
            "logo": _normalize_logo_url(
                getattr(team1, "logo", None)
                or getattr(team1, "logo_url", None)
                or getattr(team1, "image_url", None)
            ),
        },
        "team2": {
            "id": getattr(team2, "id", None),
            "name": getattr(team2, "name", None),
            "tag": getattr(team2, "tag", None) or getattr(team2, "short", None),
            "score": getattr(team2, "score", None),
            "logo": _normalize_logo_url(
                getattr(team2, "logo", None)
                or getattr(team2, "logo_url", None)
                or getattr(team2, "image_url", None)
            ),
        },
    }


def _find_match_snapshot_for_detail(match_id: int) -> dict[str, Any] | None:
    def _scan_rows(rows: list[Any]) -> dict[str, Any] | None:
        for row in rows:
            row_id = row.get("match_id") if isinstance(row, dict) else getattr(row, "match_id", None)
            if row_id == match_id:
                return _compact_match_snapshot(row)
        return None

    try:
        hit = _scan_rows(vlr.matches.live(limit=80) or [])
        if hit:
            return hit
    except Exception:
        pass

    for status in ("completed", "upcoming"):
        for refresh in (False, True):
            try:
                rows = list_vct_matches_for_home(
                    status=status,
                    limit=120,
                    max_event_pages=3,
                    refresh=refresh,
                )
            except Exception:
                continue
            hit = _scan_rows(rows)
            if hit:
                return hit

    for page in (1, 2):
        try:
            rows = vlr.matches.completed(page=page, limit=100) or []
            hit = _scan_rows(rows)
            if hit:
                return hit
        except Exception:
            continue

    return None


def _normalize_best_of(*texts: str | None) -> str | None:
    for text in texts:
        if not text:
            continue
        lowered = text.lower()
        match = re.search(r"\bbo\s*([1-9])\b", lowered)
        if match:
            return f"BO {match.group(1)}"
        match = re.search(r"\bbest\s*of\s*([1-9])\b", lowered)
        if match:
            return f"BO {match.group(1)}"
    return None


def _paginate(items: list[Any], page: int, page_size: int) -> dict[str, Any]:
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    start = (page - 1) * page_size
    end = start + page_size
    sliced = items[start:end]
    return {
        "items": sliced,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": len(items),
            "total_pages": (len(items) + page_size - 1) // page_size,
        },
    }


def list_completed_matches(page: int | None = 1, limit: int | None = 50) -> list[Any]:
    data = vlr.matches.completed(page=page, limit=limit, timeout=8)
    return sorted(data, key=_match_dt_key, reverse=True)


def list_upcoming_matches(page: int | None = 1, limit: int | None = 50) -> list[Any]:
    data = vlr.matches.upcoming(page=page, limit=limit, timeout=8)
    return sorted(data, key=_match_dt_key)


def list_live_matches(limit: int | None = 50) -> list[Any]:
    return vlr.matches.live(limit=limit, timeout=8)


def list_vct_events(status: str = "all", page: int = 1, limit: int | None = 50) -> list[Any]:
    data = vlr.events.list_events(tier="vct", status=status, page=page, limit=limit, timeout=8)
    return sorted(data, key=lambda x: (x.start_date or date(1970, 1, 1), x.end_date or date(1970, 1, 1)))


def get_event_info(event_id: int) -> Any:
    return vlr.events.info(event_id=event_id, timeout=8)


def get_event_matches(event_id: int, stage: str | None = None, limit: int | None = None) -> list[Any]:
    data = vlr.events.matches(event_id=event_id, stage=stage, limit=limit, timeout=8)
    return sorted(data, key=_match_dt_key)


def get_event_match_summary(event_id: int) -> Any:
    return vlr.events.match_summary(event_id=event_id, timeout=8)


def get_event_standings(event_id: int, stage: str | None = None) -> Any:
    return vlr.events.standings(event_id=event_id, stage=stage, timeout=8)


def get_event_stages(event_id: int) -> list[Any]:
    return vlr.events.stages(event_id=event_id, timeout=8)


def get_match_detail(match_id: int) -> dict[str, Any]:
    info = vlr.series.info(match_id=match_id)
    info_payload = to_jsonable(info)
    if not isinstance(info_payload, dict):
        info_payload = {}
    series_maps = vlr.series.matches(series_id=match_id)
    total_stats = None
    map_stats: list[Any] = []
    for map_item in series_maps:
        if (map_item.map_name or "").lower() == "all":
            total_stats = map_item
        else:
            map_stats.append(map_item)
    team_rows = []
    for team in (getattr(info, "teams", None) or ()):
        logo = None
        tag = getattr(team, "short", None)
        if getattr(team, "id", None):
            team_info = _team_info(team.id)
            if team_info:
                logo = team_info.logo_url
                if not tag:
                    tag = team_info.tag
        team_rows.append(
            {
                "id": getattr(team, "id", None),
                "name": getattr(team, "name", None),
                "short": getattr(team, "short", None),
                "tag": tag,
                "country": getattr(team, "country", None),
                "score": getattr(team, "score", None),
                "logo_url": logo,
            }
        )

    needs_fallback = (
        _score_missing(info_payload.get("score"))
        or len(team_rows) < 2
        or all((str(t.get("name") or "").strip().lower() in {"", "-", "tbd"}) for t in team_rows)
    )
    if needs_fallback:
        snapshot = _find_match_snapshot_for_detail(match_id)
        if snapshot:
            snap_score = snapshot.get("score")
            if _score_missing(info_payload.get("score")) and not _score_missing(snap_score):
                info_payload["score"] = [snap_score[0], snap_score[1]]
            if not info_payload.get("best_of") and snapshot.get("best_of"):
                info_payload["best_of"] = snapshot.get("best_of")
            if not info_payload.get("date") and snapshot.get("date"):
                info_payload["date"] = snapshot.get("date")
            if not info_payload.get("time") and snapshot.get("time"):
                info_payload["time"] = snapshot.get("time")

            snap_teams = [snapshot.get("team1") or {}, snapshot.get("team2") or {}]
            if len(team_rows) < 2:
                team_rows = []
                for snap in snap_teams:
                    team_rows.append(
                        {
                            "id": snap.get("id"),
                            "name": snap.get("name"),
                            "short": snap.get("tag"),
                            "tag": snap.get("tag"),
                            "country": None,
                            "score": snap.get("score"),
                            "logo_url": _normalize_logo_url(
                                snap.get("logo") or snap.get("logo_url") or snap.get("image_url")
                            ),
                        }
                    )
            else:
                used = set()
                for idx, snap in enumerate(snap_teams):
                    target = None
                    snap_id = snap.get("id")
                    if snap_id is not None:
                        for i, row in enumerate(team_rows):
                            if i in used:
                                continue
                            if row.get("id") == snap_id:
                                target = (i, row)
                                break
                    if target is None and idx < len(team_rows):
                        target = (idx, team_rows[idx])
                    if target is None:
                        continue
                    row_index, row = target
                    used.add(row_index)

                    row_name = str(row.get("name") or "").strip().lower()
                    if not row.get("id") and snap.get("id") is not None:
                        row["id"] = snap.get("id")
                    if row_name in {"", "-", "tbd"} and snap.get("name"):
                        row["name"] = snap.get("name")
                    if not row.get("short") and snap.get("tag"):
                        row["short"] = snap.get("tag")
                    if not row.get("tag") and snap.get("tag"):
                        row["tag"] = snap.get("tag")
                    if row.get("score") is None and snap.get("score") is not None:
                        row["score"] = snap.get("score")
                    if not row.get("logo_url"):
                        row["logo_url"] = _normalize_logo_url(
                            snap.get("logo") or snap.get("logo_url") or snap.get("image_url")
                        )

    return {
        "info": info_payload,
        "event_image_url": _event_image_url(getattr(info, "event", "") or ""),
        "teams": team_rows,
        "total_stats": total_stats,
        "maps": map_stats,
    }


@lru_cache(maxsize=8192)
def _series_info(match_id: int) -> Any:
    return vlr.series.info(match_id=match_id, timeout=6)


@lru_cache(maxsize=512)
def _event_image_url(event_name: str) -> str | None:
    if not event_name:
        return None
    try:
        candidates = vlr.search.search_events(event_name)
    except Exception:
        return None
    if not candidates:
        return None
    normalized = event_name.strip().lower()
    for item in candidates:
        name = (getattr(item, "name", None) or "").strip().lower()
        if name == normalized and getattr(item, "image_url", None):
            return item.image_url
    first = candidates[0]
    return getattr(first, "image_url", None)


def _infer_vct_region(event_obj: Any) -> str:
    name = (getattr(event_obj, "name", "") or "").lower()
    if "americas" in name:
        return "Americas"
    if "emea" in name:
        return "EMEA"
    if "pacific" in name:
        return "Pacific"
    if "china" in name:
        return "China"
    if "masters" in name:
        return "Masters"
    if "champions" in name:
        return "Champions"
    region = getattr(event_obj, "region", None) or "Other"
    return str(region)


def _fetch_event_matches_safe(event_id: int) -> list[Any]:
    try:
        return vlr.events.matches(event_id=event_id)
    except Exception:
        return []


def _normalize_logo_url(url: str | None) -> str | None:
    if not url:
        return None
    text = str(url).strip()
    if not text:
        return None
    if text.startswith("//"):
        return f"https:{text}"
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return f"https://{text.lstrip('/')}"


def list_vct_matches_for_home(
    status: str = "upcoming",
    limit: int = 5,
    max_event_pages: int = 2,
    refresh: bool = False,
) -> list[dict[str, Any]]:
    status = (status or "upcoming").lower()
    if status not in {"upcoming", "completed"}:
        status = "upcoming"
    limit = max(1, min(int(limit or 1), 120))

    cache_key = f"home:vct_matches:v3:status={status}:limit={limit}:pages={max_event_pages}"
    cached = _get_cache(cache_key, refresh=refresh)
    if cached is not None:
        return cached

    def _is_vct_top_tier(event_name: str | None) -> bool:
        name = (event_name or "").lower()
        if "vct" not in name:
            return False
        if "challengers" in name:
            return False
        if "game changers" in name:
            return False
        return True

    source_limit = max(80, limit)
    if status == "upcoming":
        base_rows = vlr.matches.upcoming(limit=source_limit, timeout=8)
    else:
        base_rows = vlr.matches.completed(limit=source_limit, timeout=8)
    filtered_rows = [m for m in base_rows if _is_vct_top_tier(getattr(m, "event", ""))]

    # Stability first: keep a bounded time window to avoid heavy crawling/requests.
    now = datetime.utcnow()
    if status == "completed":
        min_dt = now - timedelta(days=45)
        bounded = [m for m in filtered_rows if _match_dt_key(m) >= min_dt]
        if bounded:
            filtered_rows = bounded
    else:
        max_dt = now + timedelta(days=45)
        bounded = [m for m in filtered_rows if _match_dt_key(m) <= max_dt]
        if bounded:
            filtered_rows = bounded

    if status == "upcoming":
        filtered_rows.sort(key=_match_dt_key)
    else:
        filtered_rows.sort(key=_match_dt_key, reverse=True)

    selected = filtered_rows[:limit]
    team_ids: list[int] = []
    for m in selected:
        t1 = getattr(m, "team1", None)
        t2 = getattr(m, "team2", None)
        tid1 = getattr(t1, "id", None)
        tid2 = getattr(t2, "id", None)
        if isinstance(tid1, int) and tid1 > 0:
            team_ids.append(tid1)
        if isinstance(tid2, int) and tid2 > 0:
            team_ids.append(tid2)

    # Cap enrichment to avoid request spikes; _team_info itself is cached.
    unique_team_ids = list(dict.fromkeys(team_ids))[:60]
    team_logo_map: dict[int, str | None] = {}
    team_tag_map: dict[int, str | None] = {}
    if unique_team_ids:
        worker_count = max(1, min(4, len(unique_team_ids)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            future_map = {pool.submit(_team_info, team_id): team_id for team_id in unique_team_ids}
            for future in as_completed(future_map):
                team_id = future_map[future]
                try:
                    info = future.result()
                except Exception:
                    info = None
                if not info:
                    continue
                team_logo_map[team_id] = _normalize_logo_url(getattr(info, "logo_url", None))
                team_tag_map[team_id] = getattr(info, "tag", None)

    out: list[dict[str, Any]] = []
    for m in selected:
        dt = _match_dt_key(m)
        team1 = getattr(m, "team1", None)
        team2 = getattr(m, "team2", None)
        team1_id = getattr(team1, "id", None)
        team2_id = getattr(team2, "id", None)
        team1_logo = _normalize_logo_url(
            getattr(team1, "logo", None)
            or getattr(team1, "logo_url", None)
            or getattr(team1, "image_url", None)
        )
        team2_logo = _normalize_logo_url(
            getattr(team2, "logo", None)
            or getattr(team2, "logo_url", None)
            or getattr(team2, "image_url", None)
        )
        if not team1_logo and isinstance(team1_id, int):
            team1_logo = team_logo_map.get(team1_id)
        if not team2_logo and isinstance(team2_id, int):
            team2_logo = team_logo_map.get(team2_id)
        team1_tag = getattr(team1, "tag", None) or getattr(team1, "short", None)
        team2_tag = getattr(team2, "tag", None) or getattr(team2, "short", None)
        if not team1_tag and isinstance(team1_id, int):
            team1_tag = team_tag_map.get(team1_id)
        if not team2_tag and isinstance(team2_id, int):
            team2_tag = team_tag_map.get(team2_id)

        best_of = None
        if not best_of:
            best_of = _normalize_best_of(getattr(m, "event_phase", None))
        if not best_of:
            phase_text = (getattr(m, "event_phase", "") or "").lower()
            if any(x in phase_text for x in ["grand final", "lower final", "upper final", "final"]):
                best_of = "BO 5"
            else:
                best_of = "BO 3"

        out.append(
            {
                "match_id": m.match_id,
                "status": m.status,
                "event_id": None,
                "event_name": getattr(m, "event", None),
                "region": None,
                "stage": None,
                "phase": getattr(m, "event_phase", None),
                "date": getattr(m, "date", None),
                "time": m.time,
                "match_datetime": dt,
                "best_of": best_of,
                "team1": {
                    "id": team1_id,
                    "name": getattr(team1, "name", None),
                    "country": getattr(team1, "country", None),
                    "score": getattr(team1, "score", None),
                    "logo": team1_logo,
                    "tag": team1_tag,
                    "is_winner": None,
                },
                "team2": {
                    "id": team2_id,
                    "name": getattr(team2, "name", None),
                    "country": getattr(team2, "country", None),
                    "score": getattr(team2, "score", None),
                    "logo": team2_logo,
                    "tag": team2_tag,
                    "is_winner": None,
                },
            }
        )

    _set_cache(cache_key, out)
    return out


def _aggregate_players_from_match_all(
    acc: dict[str, dict[str, Any]],
    players: list[Any],
) -> None:
    for p in players:
        key = str(p.player_id) if p.player_id else f"{p.team_short}:{p.name}"
        if key not in acc:
            acc[key] = {
                "player_id": p.player_id,
                "name": p.name,
                "country": p.country,
                "team_id": p.team_id,
                "team_short": p.team_short,
                "matches_played": 0,
                "agents_counter": Counter(),
                **{f: 0 for f in _NUMERIC_SUM_FIELDS},
                **{f"{f}_sum": 0.0 for f in _NUMERIC_AVG_FIELDS},
                **{f"{f}_count": 0 for f in _NUMERIC_AVG_FIELDS},
            }
        row = acc[key]
        row["matches_played"] += 1
        for agent in p.agents or []:
            if agent:
                row["agents_counter"][agent] += 1
        for field in _NUMERIC_SUM_FIELDS:
            value = getattr(p, field, None)
            if value is not None:
                row[field] += value
        for field in _NUMERIC_AVG_FIELDS:
            value = getattr(p, field, None)
            if value is not None:
                row[f"{field}_sum"] += float(value)
                row[f"{field}_count"] += 1


def _finalize_player_aggregate(acc: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in acc.values():
        item = {
            "player_id": row["player_id"],
            "name": row["name"],
            "country": row["country"],
            "team_id": row["team_id"],
            "team_short": row["team_short"],
            "matches_played": row["matches_played"],
            "agents": dict(row["agents_counter"]),
            "kills": row["k"],
            "deaths": row["d"],
            "assists": row["a"],
            "fk": row["fk"],
            "fd": row["fd"],
            "kd_diff": row["kd_diff"],
            "fk_diff": row["fk_diff"],
            "kd_ratio": round(row["k"] / max(row["d"], 1), 3),
        }
        for field in _NUMERIC_AVG_FIELDS:
            count = row[f"{field}_count"]
            item[field] = round(row[f"{field}_sum"] / count, 3) if count else None
        out.append(item)
    return out


def get_event_player_stats(event_id: int, sort_by: str = "r", order: str = "desc") -> list[dict[str, Any]]:
    event_matches = vlr.events.matches(event_id=event_id)
    completed = [m for m in event_matches if m.status == "completed"]
    aggregate: dict[str, dict[str, Any]] = {}

    for match_obj in completed:
        all_maps = vlr.series.matches(series_id=match_obj.match_id)
        total_map = next((m for m in all_maps if (m.map_name or "").lower() == "all"), None)
        if not total_map:
            continue
        _aggregate_players_from_match_all(aggregate, total_map.players)

    rows = _finalize_player_aggregate(aggregate)
    if not rows:
        return rows

    sort_key_map = {
        "r": "r",
        "rating": "r",
        "acs": "acs",
        "adr": "adr",
        "kast": "kast",
        "hs_pct": "hs_pct",
        "kills": "kills",
        "deaths": "deaths",
        "assists": "assists",
        "fk": "fk",
        "fd": "fd",
        "kd_diff": "kd_diff",
        "fk_diff": "fk_diff",
        "kd_ratio": "kd_ratio",
        "matches_played": "matches_played",
    }
    key_name = sort_key_map.get(sort_by.lower(), "r")
    reverse = order.lower() != "asc"
    present = [row for row in rows if row.get(key_name) is not None]
    missing = [row for row in rows if row.get(key_name) is None]
    present.sort(key=lambda x: x[key_name], reverse=reverse)
    rows = present + missing
    for idx, row in enumerate(rows, start=1):
        row["rank"] = idx
    return rows


@lru_cache(maxsize=4096)
def _team_info(team_id: int) -> Any:
    return vlr.teams.info(team_id=team_id, timeout=8)


@lru_cache(maxsize=4096)
def _team_roster(team_id: int) -> list[Any]:
    return vlr.teams.roster(team_id=team_id)


@lru_cache(maxsize=4096)
def _team_previous_players(team_id: int) -> list[Any]:
    return vlr.teams.previous_players(team_id=team_id)


def _crawl_vct_events(max_pages: int = 20, per_page: int = 50) -> list[Any]:
    events: list[Any] = []
    for page in range(1, max_pages + 1):
        batch = vlr.events.list_events(tier="vct", status="all", page=page, limit=per_page)
        if not batch:
            break
        events.extend(batch)
        if len(batch) < per_page:
            break
    unique = {e.id: e for e in events}
    return sorted(
        unique.values(),
        key=lambda e: (e.start_date or date(1970, 1, 1), e.end_date or date(1970, 1, 1)),
        reverse=True,
    )


def _fetch_event_teams(event_obj: Any) -> tuple[str, list[Any]]:
    try:
        return event_obj.status, vlr.events.teams(event_id=event_obj.id)
    except Exception:
        return event_obj.status, []


def _fetch_team_roster_safe(team_id: int) -> tuple[int, list[Any]]:
    try:
        return team_id, _team_roster(team_id)
    except Exception:
        return team_id, []


def _fetch_team_previous_players_safe(team_id: int) -> tuple[int, list[Any]]:
    try:
        return team_id, _team_previous_players(team_id)
    except Exception:
        return team_id, []


def list_all_vct_teams(
    max_event_pages: int = 20,
    page: int = 1,
    page_size: int = 50,
    refresh: bool = False,
) -> dict[str, Any]:
    cache_key = f"teams:max_event_pages={max_event_pages}"
    cached = _get_cache(cache_key, refresh=refresh)
    if cached is None:
        events = _crawl_vct_events(max_pages=max_event_pages, per_page=20)
        team_map: dict[int, dict[str, Any]] = {}

        if events:
            worker_count = max(1, min(12, len(events)))
            with ThreadPoolExecutor(max_workers=worker_count) as pool:
                futures = [pool.submit(_fetch_event_teams, event) for event in events]
                for future in as_completed(futures):
                    event_status, event_teams = future.result()
                    for team in event_teams:
                        if not team.id:
                            continue
                        row = team_map.setdefault(
                            team.id,
                            {
                                "team_id": team.id,
                                "name": team.name,
                                "tag": None,
                                "country": None,
                                "is_active": False,
                                "logo_url": None,
                                "logo_url_light": None,
                                "logo_url_dark": None,
                                "type": team.type,
                            },
                        )
                        if not row["name"] and team.name:
                            row["name"] = team.name
                        if event_status in {"ongoing", "upcoming"}:
                            row["is_active"] = True

        teams = list(team_map.values())
        teams.sort(key=lambda t: (not t["is_active"], (t["name"] or "").lower()))
        _set_cache(cache_key, teams)
    else:
        teams = cached
    return _paginate(teams, page=page, page_size=page_size)


def list_vct_region_team_selector(
    max_event_pages: int = 2,
    refresh: bool = False,
) -> list[dict[str, Any]]:
    cache_key = f"home:selector:pages={max_event_pages}"
    cached = _get_cache(cache_key, refresh=refresh)
    if cached is not None:
        return cached

    events = _crawl_vct_events(max_pages=max_event_pages, per_page=20)
    active_events = [e for e in events if (e.status or "").lower() in {"upcoming", "ongoing"}]
    if not active_events:
        active_events = events

    region_map: dict[str, dict[int, dict[str, Any]]] = {}
    for event in active_events:
        region = _infer_vct_region(event)
        region_teams = region_map.setdefault(region, {})
        for team in _fetch_event_teams(event)[1]:
            if not team.id:
                continue
            row = region_teams.setdefault(
                team.id,
                {
                    "team_id": team.id,
                    "name": team.name,
                    "type": team.type,
                    "logo_url": None,
                    "country": None,
                    "tag": None,
                },
            )
            if not row["name"] and team.name:
                row["name"] = team.name

        # 补齐被淘汰队伍：events.teams 在某些阶段可能仅返回当前阶段队伍
        # 因此再从赛事全量 match 列表中回填所有出现过的队伍。
        for match_obj in _fetch_event_matches_safe(event.id):
            for match_team in getattr(match_obj, "teams", ()) or ():
                team_id = getattr(match_team, "id", None)
                if not team_id:
                    continue
                row = region_teams.setdefault(
                    team_id,
                    {
                        "team_id": team_id,
                        "name": getattr(match_team, "name", None),
                        "type": None,
                        "logo_url": None,
                        "country": getattr(match_team, "country", None),
                        "tag": None,
                    },
                )
                if not row.get("name") and getattr(match_team, "name", None):
                    row["name"] = match_team.name
                if not row.get("country") and getattr(match_team, "country", None):
                    row["country"] = match_team.country

    all_team_ids = sorted({team_id for teams in region_map.values() for team_id in teams})
    if all_team_ids:
        worker_count = max(1, min(12, len(all_team_ids)))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            future_map = {pool.submit(_team_info, team_id): team_id for team_id in all_team_ids}
            for future in as_completed(future_map):
                team_id = future_map[future]
                try:
                    info = future.result()
                except Exception:
                    info = None
                if not info:
                    continue
                for teams in region_map.values():
                    row = teams.get(team_id)
                    if row is None:
                        continue
                    row["logo_url"] = info.logo_url
                    row["country"] = info.country
                    row["tag"] = info.tag

    regions_out: list[dict[str, Any]] = []
    for region, teams in sorted(region_map.items(), key=lambda x: x[0].lower()):
        team_list = sorted(teams.values(), key=lambda x: (x.get("name") or "").lower())
        team_list = [
            t
            for t in team_list
            if (t.get("name") or "").strip().lower() not in {"", "tbd", "to be decided"}
        ]
        if team_list:
            regions_out.append({"region": region, "teams": team_list})

    _set_cache(cache_key, regions_out)
    return regions_out


def _normalize_player_status(raw_status: str | None) -> str:
    if not raw_status:
        return "retired"
    lowered = raw_status.lower()
    if "inactive" in lowered or "retired" in lowered or "former" in lowered:
        return "retired"
    if "active" in lowered or "current" in lowered:
        return "active"
    return "retired"


def list_all_vct_players(
    max_event_pages: int = 20,
    page: int = 1,
    page_size: int = 50,
    status_filter: str = "all",
    refresh: bool = False,
) -> dict[str, Any]:
    status_filter = (status_filter or "all").lower()
    cache_key = f"players:max_event_pages={max_event_pages}:status={status_filter}"
    cached = _get_cache(cache_key, refresh=refresh)
    if cached is None:
        teams_result = list_all_vct_teams(max_event_pages=max_event_pages, page=1, page_size=5000, refresh=refresh)
        teams: list[dict[str, Any]] = teams_result["items"]
        include_roster = True
        include_former = False

        # 优先保证移动端首屏速度："all" 默认返回现役目录。
        if status_filter == "active":
            teams = [t for t in teams if t.get("is_active")]
            include_roster = True
            include_former = False
        elif status_filter == "retired":
            teams = [t for t in teams if not t.get("is_active")]
            include_roster = False
            include_former = True
        else:
            teams = [t for t in teams if t.get("is_active")]
            include_roster = True
            include_former = False

        players: dict[int, dict[str, Any]] = {}
        team_names = {t["team_id"]: (t.get("name") or "") for t in teams if t.get("team_id")}

        team_ids = [t["team_id"] for t in teams if t.get("team_id")]

        if include_roster and team_ids:
            worker_count = max(1, min(16, len(team_ids)))
            with ThreadPoolExecutor(max_workers=worker_count) as pool:
                futures = [pool.submit(_fetch_team_roster_safe, team_id) for team_id in team_ids]
                for future in as_completed(futures):
                    team_id, members = future.result()
                    team_name = team_names.get(team_id, "")
                    for member in members:
                        if (member.role or "").lower() != "player" or not member.player_id:
                            continue
                        pid = member.player_id
                        if pid not in players:
                            players[pid] = {
                                "player_id": pid,
                                "ign": member.ign,
                                "real_name": member.real_name,
                                "country": member.country,
                                "status": "active",
                                "current_teams": set(),
                                "history_teams": set(),
                            }
                        players[pid]["status"] = "active"
                        players[pid]["current_teams"].add(team_name)
                        players[pid]["history_teams"].add(team_name)

        if include_former and team_ids:
            worker_count = max(1, min(8, len(team_ids)))
            with ThreadPoolExecutor(max_workers=worker_count) as pool:
                futures = [pool.submit(_fetch_team_previous_players_safe, team_id) for team_id in team_ids]
                for future in as_completed(futures):
                    team_id, former_rows = future.result()
                    team_name = team_names.get(team_id, "")
                    for former in former_rows:
                        if former.position and former.position.lower() != "player":
                            continue
                        if not former.player_id:
                            continue
                        pid = former.player_id
                        normalized_status = _normalize_player_status(former.status)
                        if pid not in players:
                            players[pid] = {
                                "player_id": pid,
                                "ign": former.ign,
                                "real_name": former.real_name,
                                "country": former.country,
                                "status": normalized_status,
                                "current_teams": set(),
                                "history_teams": set(),
                            }
                        if players[pid]["status"] != "active":
                            players[pid]["status"] = normalized_status
                        players[pid]["history_teams"].add(team_name)
                        if normalized_status == "active":
                            players[pid]["current_teams"].add(team_name)

        rows = []
        for row in players.values():
            rows.append(
                {
                    **row,
                    "current_teams": sorted(row["current_teams"]),
                    "history_teams": sorted(row["history_teams"]),
                }
            )
        rows.sort(key=lambda p: (p["status"] != "active", (p["ign"] or "").lower()))
        _set_cache(cache_key, rows)
    else:
        rows = cached

    if status_filter in {"active", "retired"}:
        rows = [p for p in rows if p["status"] == status_filter]
    return _paginate(rows, page=page, page_size=page_size)


def get_player_profile(player_id: int) -> Any:
    return vlr.players.profile(player_id=player_id)


def get_player_agent_stats(player_id: int, timespan: str = "all") -> list[Any]:
    return vlr.players.agent_stats(player_id=player_id, timespan=timespan)


def get_player_matches(player_id: int, page: int | None = 1, limit: int | None = 20) -> list[Any]:
    data = vlr.players.matches(player_id=player_id, page=page, limit=limit)
    return sorted(data, key=lambda m: (m.date or date(1970, 1, 1), m.time or time(0, 0)), reverse=True)


def build_player_career_summary(player_id: int) -> dict[str, Any]:
    profile = vlr.players.profile(player_id=player_id)
    agent_rows = vlr.players.agent_stats(player_id=player_id, timespan="all")
    totals = {
        "agents_played": len(agent_rows),
        "kills": 0,
        "deaths": 0,
        "assists": 0,
        "first_kills": 0,
        "first_deaths": 0,
        "rounds_played": 0,
    }
    weighted = {"rating_sum": 0.0, "acs_sum": 0.0, "adr_sum": 0.0, "kast_sum": 0.0}
    weight_rounds = 0

    for row in agent_rows:
        totals["kills"] += row.kills or 0
        totals["deaths"] += row.deaths or 0
        totals["assists"] += row.assists or 0
        totals["first_kills"] += row.first_kills or 0
        totals["first_deaths"] += row.first_deaths or 0
        rounds = row.rounds_played or 0
        totals["rounds_played"] += rounds
        if rounds > 0:
            weight_rounds += rounds
            weighted["rating_sum"] += (row.rating or 0) * rounds
            weighted["acs_sum"] += (row.acs or 0) * rounds
            weighted["adr_sum"] += (row.adr or 0) * rounds
            weighted["kast_sum"] += (row.kast or 0) * rounds

    averages = {
        "rating": round(weighted["rating_sum"] / weight_rounds, 3) if weight_rounds else None,
        "acs": round(weighted["acs_sum"] / weight_rounds, 3) if weight_rounds else None,
        "adr": round(weighted["adr_sum"] / weight_rounds, 3) if weight_rounds else None,
        "kast": round(weighted["kast_sum"] / weight_rounds, 3) if weight_rounds else None,
        "kd_ratio": round(totals["kills"] / max(totals["deaths"], 1), 3),
    }
    return {
        "profile": profile,
        "agent_stats": agent_rows,
        "career_totals": {**totals, **averages},
    }


def get_team_info(team_id: int) -> Any:
    return vlr.teams.info(team_id=team_id)


def get_team_roster(team_id: int) -> list[Any]:
    return vlr.teams.roster(team_id=team_id)


def get_team_schedule(
    team_id: int,
    include_completed: bool = True,
    completed_limit: int = 20,
    upcoming_limit: int = 20,
) -> dict[str, Any]:
    upcoming = vlr.teams.upcoming_matches(team_id=team_id, limit=upcoming_limit)
    completed = vlr.teams.completed_matches(team_id=team_id, limit=completed_limit) if include_completed else []
    completed_sorted = sorted(
        completed,
        key=lambda x: x.match_datetime or datetime(1970, 1, 1),
        reverse=True,
    )
    upcoming_sorted = sorted(upcoming, key=lambda x: x.match_datetime or datetime(1970, 1, 1))
    return {"upcoming": upcoming_sorted, "completed": completed_sorted}


def get_team_detail(team_id: int) -> dict[str, Any]:
    upcoming = vlr.teams.upcoming_matches(team_id=team_id, limit=30)
    completed = vlr.teams.completed_matches(team_id=team_id, limit=30)
    upcoming_sorted = sorted(upcoming, key=lambda x: x.match_datetime or datetime(1970, 1, 1))
    completed_sorted = sorted(
        completed,
        key=lambda x: x.match_datetime or datetime(1970, 1, 1),
        reverse=True,
    )
    return {
        "info": vlr.teams.info(team_id=team_id),
        "roster": vlr.teams.roster(team_id=team_id),
        "upcoming_matches": upcoming_sorted,
        "completed_matches": completed_sorted,
        "placements": vlr.teams.placements(team_id=team_id),
    }


def search_entities(query: str, search_type: str = "all") -> Any:
    st = (search_type or "all").lower()
    if st == "players":
        return {"query": query, "players": vlr.search.search_players(query)}
    if st == "teams":
        return {"query": query, "teams": vlr.search.search_teams(query)}
    if st == "events":
        return {"query": query, "events": vlr.search.search_events(query)}
    if st == "series":
        return {"query": query, "series": vlr.search.search_series(query)}
    return vlr.search.search(query)
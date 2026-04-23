from flask import Blueprint, jsonify, request

from services.vlr_service import (
    get_team_detail,
    get_team_info,
    get_team_roster,
    get_team_schedule,
    list_all_vct_teams,
    list_vct_region_team_selector,
    to_jsonable,
)

team_bp = Blueprint("team", __name__)


def _int_arg(name: str, default: int) -> int:
    raw = request.args.get(name, default)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _bool_arg(name: str, default: bool = False) -> bool:
    raw = request.args.get(name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "y", "on"}


@team_bp.route("/")
def list_teams():
    page = _int_arg("page", 1)
    page_size = _int_arg("page_size", 50)
    max_event_pages = _int_arg("max_event_pages", 1)
    refresh = _bool_arg("refresh", False)
    status = request.args.get("status", "active").lower()

    data = list_all_vct_teams(max_event_pages=max_event_pages, page=1, page_size=5000, refresh=refresh)
    teams = data["items"]
    if status == "active":
        teams = [t for t in teams if t.get("is_active")]
    elif status in {"inactive", "retired"}:
        teams = [t for t in teams if not t.get("is_active")]

    start = (max(1, page) - 1) * max(1, page_size)
    end = start + max(1, page_size)
    sliced = teams[start:end]
    payload = {
        "items": sliced,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": len(teams),
            "total_pages": (len(teams) + page_size - 1) // page_size,
        },
    }
    return jsonify(to_jsonable(payload))


@team_bp.route("/<int:team_id>")
def detail(team_id: int):
    payload = get_team_detail(team_id)
    return jsonify(to_jsonable(payload))


@team_bp.route("/<int:team_id>/basic")
def info(team_id: int):
    data = get_team_info(team_id)
    return jsonify(to_jsonable(data))


@team_bp.route("/<int:team_id>/roster")
def roster(team_id: int):
    data = get_team_roster(team_id)
    return jsonify({"items": to_jsonable(data)})


@team_bp.route("/<int:team_id>/schedule")
def schedule(team_id: int):
    include_completed = _bool_arg("include_completed", True)
    completed_limit = _int_arg("completed_limit", 20)
    upcoming_limit = _int_arg("upcoming_limit", 20)
    data = get_team_schedule(
        team_id=team_id,
        include_completed=include_completed,
        completed_limit=completed_limit,
        upcoming_limit=upcoming_limit,
    )
    return jsonify(to_jsonable(data))


@team_bp.route("/selector")
def selector():
    max_event_pages = _int_arg("max_event_pages", 2)
    refresh = _bool_arg("refresh", False)
    data = list_vct_region_team_selector(max_event_pages=max_event_pages, refresh=refresh)
    return jsonify({"items": to_jsonable(data), "max_event_pages": max_event_pages})
from flask import Blueprint, jsonify, request

from services.vlr_service import (
    build_player_career_summary,
    get_player_agent_stats,
    get_player_matches,
    get_player_profile,
    list_all_vct_players,
    to_jsonable,
)

player_bp = Blueprint("player", __name__)


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


@player_bp.route("/")
def list_players():
    page = _int_arg("page", 1)
    page_size = _int_arg("page_size", 50)
    max_event_pages = _int_arg("max_event_pages", 1)
    status = request.args.get("status", "active")
    refresh = _bool_arg("refresh", False)
    data = list_all_vct_players(
        max_event_pages=max_event_pages,
        page=page,
        page_size=page_size,
        status_filter=status,
        refresh=refresh,
    )
    return jsonify(to_jsonable(data))


@player_bp.route("/<int:player_id>")
def profile(player_id: int):
    recent_limit = _int_arg("recent_limit", 10)
    summary = build_player_career_summary(player_id)
    recent_matches = get_player_matches(player_id=player_id, page=1, limit=recent_limit)
    payload = {**summary, "recent_matches": recent_matches}
    return jsonify(to_jsonable(payload))


@player_bp.route("/<int:player_id>/basic")
def basic_profile(player_id: int):
    data = get_player_profile(player_id)
    return jsonify(to_jsonable(data))


@player_bp.route("/<int:player_id>/agents")
def agents(player_id: int):
    timespan = request.args.get("timespan", "all")
    data = get_player_agent_stats(player_id=player_id, timespan=timespan)
    return jsonify({"items": to_jsonable(data), "timespan": timespan})


@player_bp.route("/<int:player_id>/matches")
def matches(player_id: int):
    page = _int_arg("page", 1)
    limit = _int_arg("limit", 20)
    data = get_player_matches(player_id=player_id, page=page, limit=limit)
    return jsonify({"items": to_jsonable(data), "page": page, "limit": limit})
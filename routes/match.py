from flask import Blueprint, jsonify, request

from services.vlr_service import (
    get_match_detail,
    list_completed_matches,
    list_live_matches,
    list_upcoming_matches,
    list_vct_matches_for_home,
    to_jsonable,
)

match_bp = Blueprint("match", __name__)


def _int_arg(name: str, default: int) -> int:
    raw = request.args.get(name, default)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


@match_bp.route("/history")
def history_matches():
    page = _int_arg("page", 1)
    limit = _int_arg("limit", 50)
    data = list_completed_matches(page=page, limit=limit)
    return jsonify({"items": to_jsonable(data), "page": page, "limit": limit})


@match_bp.route("/upcoming")
def upcoming_matches():
    page = _int_arg("page", 1)
    limit = _int_arg("limit", 50)
    data = list_upcoming_matches(page=page, limit=limit)
    return jsonify({"items": to_jsonable(data), "page": page, "limit": limit})


@match_bp.route("/live")
def live_matches():
    limit = _int_arg("limit", 50)
    data = list_live_matches(limit=limit)
    return jsonify({"items": to_jsonable(data), "limit": limit})


@match_bp.route("/vct")
def vct_matches():
    status = request.args.get("status", "upcoming")
    page = _int_arg("page", 1)
    limit = _int_arg("limit", 20)
    max_event_pages = _int_arg("max_event_pages", 2)
    refresh = request.args.get("refresh", "false").lower() in {"1", "true", "yes", "y", "on"}
    page = max(1, page)
    limit = max(1, limit)
    data = list_vct_matches_for_home(
        status=status,
        limit=limit,
        max_event_pages=max_event_pages,
        refresh=refresh,
    )
    has_next = len(data) >= limit
    return jsonify(
        {
            "items": to_jsonable(data),
            "status": status,
            "page": page,
            "limit": limit,
            "has_prev": False,
            "has_next": has_next,
        }
    )


@match_bp.route("/<int:match_id>")
def match_detail(match_id: int):
    payload = get_match_detail(match_id)
    return jsonify(to_jsonable(payload))
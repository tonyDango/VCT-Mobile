from flask import Blueprint, jsonify, request

from services.vlr_service import (
    get_event_info,
    get_event_match_summary,
    get_event_matches,
    get_event_player_stats,
    get_event_stages,
    get_event_standings,
    list_vct_events,
    to_jsonable,
)

event_bp = Blueprint("event", __name__)


def _int_arg(name: str, default: int) -> int:
    raw = request.args.get(name, default)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


@event_bp.route("/")
def events():
    status = request.args.get("status", "all")
    page = _int_arg("page", 1)
    limit = _int_arg("limit", 50)
    data = list_vct_events(status=status, page=page, limit=limit)
    return jsonify({"items": to_jsonable(data), "page": page, "limit": limit, "status": status})


@event_bp.route("/<int:event_id>")
def event_detail(event_id: int):
    payload = {
        "info": get_event_info(event_id),
        "match_summary": get_event_match_summary(event_id),
        "stages": get_event_stages(event_id),
        "standings": get_event_standings(event_id),
    }
    return jsonify(to_jsonable(payload))


@event_bp.route("/<int:event_id>/matches")
def matches(event_id: int):
    stage = request.args.get("stage")
    limit = request.args.get("limit")
    parsed_limit = int(limit) if (limit and limit.isdigit()) else None
    status_filter = request.args.get("status")
    data = get_event_matches(event_id=event_id, stage=stage, limit=parsed_limit)
    if status_filter:
        data = [m for m in data if m.status == status_filter]
    return jsonify({"items": to_jsonable(data), "event_id": event_id, "stage": stage, "status": status_filter})


@event_bp.route("/<int:event_id>/stats")
def stats(event_id: int):
    sort_by = request.args.get("sort_by", "r")
    order = request.args.get("order", "desc")
    data = get_event_player_stats(event_id=event_id, sort_by=sort_by, order=order)
    return jsonify({"items": data, "event_id": event_id, "sort_by": sort_by, "order": order})